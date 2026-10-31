// Task track1-siren-blightbelly-20261031 (lane BLIGHT): the temporary local toxic puff (a Blightbelly's death cloud) through the
// EXISTING gas system (world/gas/puff.ts + GasSystem.addPuff): it rises to a modest concentration, spreads a little through the
// same diffusion / walls, and DISSIPATES (disposed, its layer cells cleared); storey isolation; works on the Subway and on an
// office storey without a tower field; overlapping a window breach stays within the caps and leaves the breach field untouched;
// the same exposure / mask / cough path; bounded / coalesced / cleared with the section; the absent-source fast path; the
// volumetric gas gate closes again once every layer is clean.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import {GAS} from '../src/world/gas/field';
import {GasPuffs, PUFF} from '../src/world/gas/puff';
import {installGas, type GasHost} from '../src/world/gas/system';
import {installCough} from '../src/audio/cough';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import type {StationLayout} from '../src/gen/stationTypes';
import {readTowerInfo} from '../src/world/towerShared';
import {planWindows, type WindowPlan, type WindowView} from '../src/world/officeWindows';
import {sourceCells} from '../src/world/windowBreach';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {MOOD} from '../src/world/lights';

const dpsOf = (c: number) => GAS.DPS_MAX * Math.min(1, Math.max(0, (c - GAS.THRESHOLD) / (1 - GAS.THRESHOLD)));

/** Synthetic storeys (cells): room A x 2..17 y 2..13 with a 1.5 m doorway (x 18, y 7..9) into a corridor x 19..21; sealed room C x 2..17 y 15..24; open hall x 24..63 y 2..41. */
function storey(base: number, ceil = 3) {
  const g = new Grid(66, 44);
  const carve = (x0: number, y0: number, x1: number, y1: number, area: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = area; g.floor[i] = base; g.ceil[i] = base + ceil; }
  };
  carve(2, 2, 17, 13, 0); carve(18, 7, 18, 9, 1); carve(19, 2, 21, 41, 1); carve(2, 15, 17, 24, 2); carve(24, 2, 63, 41, 3); carve(22, 30, 23, 32, 3);
  return g;
}
function synthLayout(): StationLayout {
  const g0 = storey(0), g1 = storey(4.4);
  return {grid: g0, levels: [{id: 0, role: 'main', grid: g0, baseY: 0}, {id: 1, role: 'upper', grid: g1, baseY: 4.4}], props: [], trench: {floorY: -1.15}} as unknown as StationLayout;
}

/** GasSystem with a fake host (records layer uploads); `office` = tower windows for the real office. */
function gasHost(L: StationLayout, office = false) {
  const uploads: {slot: number; rect: {x0: number; y0: number; w: number; h: number}; max: number; sum: number}[] = [];
  const hits: number[] = [];
  let clock = 0;
  const info = office ? readTowerInfo(L) : null;
  const plans: WindowPlan[] = info ? planWindows(info) : [];
  const view = {root: new THREE.Group(), glass: [], geometries: [], cracked: null, panes: new Map()} as unknown as WindowView;
  const h = {
    player: {x: 0, z: 0, y: 0, eye: 1.62, alive: true, hp: 1e6, takeDamage(a: number) { hits.push(a); this.hp -= a; }},
    layout: L,
    tower: {office: info ? {info, windows: {plans, view}} : null},
    atmosphere: {active: true, setGasLayer: (slot: number, field: ArrayLike<number>, rect: {x0: number; y0: number; w: number; h: number}) => {
      let max = 0, sum = 0;
      for (let i = 0; i < rect.w * rect.h; i++) { max = Math.max(max, field[i]); sum += field[i]; }
      uploads.push({slot, rect: {...rect}, max, sum});
    }},
    atmosphereBypass: null as string | null,
    run: {laneStore: () => undefined, setLaneStore: () => {}},
    get clock() { return clock; },
    state: 'playing',
    frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    stateListeners: [] as ((s: never, p: never) => void)[],
    bulletHitHandlers: [] as unknown[],
  };
  const sys = installGas(h as unknown as GasHost);
  h.sectionHooks[0].build!(L);
  const step = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) { clock += dt; for (const fn of h.frameHooks) fn(dt); } };
  const stand = (x: number, z: number, y = 0) => Object.assign(h.player, {x, z, y, eye: y + 1.62});
  return {h, sys, uploads, hits, step, stand};
}

/** An open walkable cell of a level grid with `clear` m of free floor around it. */
function openSpot(g: Grid, clear = 2.5, skip = 0): [number, number] {
  let n = 0;
  for (let i = 0; i < g.cells.length; i += 3) {
    const cx = i % g.w, cy = (i - cx) / g.w, x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
    if (g.walkable(cx, cy) && g.circleClear(x, z, clear) && n++ >= skip) return [x, z];
  }
  throw new Error('no open spot');
}

// ---------------------------------------------------------------------------------------------
describe('a puff rises, spreads a little, then dissipates and is disposed (measured)', () => {
  it('open hall: never instant, plateaus at a modest eye concentration while emitting, below the damage threshold by ~12 s, gone (cells cleared) at DURATION_S', () => {
    const L = synthLayout();
    const {sys, uploads, step, stand, hits} = gasHost(L);
    const bx = 22, bz = 11; // the open hall (cells 24..63 = 12..32 m)
    stand(bx, bz);
    expect(sys.addPuff({id: 'b1', level: 0, x: bx, y: 0, z: bz})).toBe(true);
    const rows: string[] = [], at = (dx: number) => sys.puffs.concentrationAt(bx + dx, 1.62, bz);
    step(0.1);
    expect(sys.exposure.c).toBeLessThan(GAS.THRESHOLD); // never an instant damage cloud
    expect(hits).toHaveLength(0);
    const samples: Record<number, number[]> = {};
    let t = 0.1;
    for (const T of [1, 3, 6, 9, 12, 16, 19.9]) { step(T - t); t = T; samples[T] = [at(0), at(1.5), at(3), at(4.5)]; rows.push(`t ${T.toFixed(1).padStart(4)} s  eye c: burst ${at(0).toFixed(3)}  1.5 m ${at(1.5).toFixed(3)}  3 m ${at(3).toFixed(3)}  4.5 m ${at(4.5).toFixed(3)}  live ${sys.puffs.list.length}`); }
    expect(samples[3][0]).toBeGreaterThan(0.3);
    expect(samples[6][0]).toBeGreaterThan(0.35);
    expect(Math.max(...Object.values(samples).flat())).toBeLessThanOrEqual(PUFF.PEAK); // never above its source peak
    expect(samples[6][2]).toBeGreaterThan(0.05); // spreads a little (3 m) ...
    expect(samples[6][3]).toBeLessThan(GAS.THRESHOLD); // ... but stays local
    expect(samples[12][0]).toBeLessThan(GAS.THRESHOLD); // dissipating: harmless by 12 s
    expect(samples[19.9].every(v => v < 0.01)).toBe(true);
    const damage = hits.reduce((s, v) => s + v, 0);
    const uploadsBefore = uploads.length;
    step(0.2); // past DURATION_S: disposed; one final upload clears its rect
    expect(sys.puffs.active).toBe(false);
    expect(sys.puffs.counts.expired).toBe(1);
    const last = uploads[uploads.length - 1];
    expect(uploads.length).toBeGreaterThan(uploadsBefore);
    expect(last.slot).toBe(0);
    expect(last.max).toBe(0);
    // afterwards: the absent-source fast path — no ticks, no uploads, no exposure
    const n = uploads.length;
    step(2);
    expect(uploads.length).toBe(n);
    expect(sys.exposure).toMatchObject({c: 0, dps: 0, source: null});
    console.info(`[blightbelly-gas] open-hall puff (PEAK ${PUFF.PEAK}, EMIT_S ${PUFF.EMIT_S}, K_LINGER ${PUFF.K_LINGER}, FADE_S ${PUFF.FADE_S}, DURATION_S ${PUFF.DURATION_S}, RADIUS_M ${PUFF.RADIUS_M}):\n${rows.join('\n')}\n`
      + `unprotected damage standing at the burst the whole time: ${damage.toFixed(1)} hp`);
  });

  it('walls / storeys: a sealed room behind a wall never gets gas, the corridor gets a fainter tongue through the doorway; the other storey none (same x, z)', () => {
    const L = synthLayout();
    const {sys, step} = gasHost(L);
    sys.addPuff({id: 'a', level: 0, x: 7, y: 0, z: 5}); // room A
    step(7);
    const p = sys.puffs.list[0];
    const inC = (x: number, z: number) => sys.puffs.concentrationAt(x, 0.5, z);
    let maxC = 0;
    for (let z = 7.75; z < 12.5; z += 0.5) for (let x = 1.25; x < 9; x += 0.5) maxC = Math.max(maxC, inC(x, z)); // sealed room C (x 1..9, z 7.5..12.5)
    expect(maxC).toBe(0);
    const roomA = sys.puffs.concentrationAt(8, 0.5, 4.25), corridor = sys.puffs.concentrationAt(10.25, 0.5, 4.25);
    expect(roomA).toBeGreaterThan(0.1);
    expect(corridor).toBeGreaterThan(0); // through the doorway
    expect(corridor).toBeLessThan(roomA);
    // storey 1 directly above (base 4.4): nothing — neither sampled nor simulated
    expect(sys.puffs.concentrationAt(7, 4.4 + 1.62, 5)).toBe(0);
    expect(p.level).toBe(0);
    expect(sys.puffs.list.every(q => q.level === 0)).toBe(true);
    // a puff on storey 1 is sampled only inside storey 1's band
    sys.addPuff({id: 'b', level: 1, x: 7, y: 4.4, z: 5});
    step(3);
    expect(sys.puffs.concentrationAt(7, 4.4 + 1.62, 5)).toBeGreaterThan(0.2);
    expect(sys.puffs.concentrationAt(7, 1.62, 5)).toBeLessThan(roomA); // storey 0 unchanged by storey 1's puff (its own puff decaying)
  });
});

// ---------------------------------------------------------------------------------------------
const cache = new Map<string, StationLayout>();
const subwayL = (seed: number) => { const k = `s${seed}`; let l = cache.get(k); if (!l) cache.set(k, (l = generateStation(seed))); return l; };
const officeL = (seed: number) => { const k = `o${seed}`; let l = cache.get(k); if (!l) cache.set(k, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'} as never))); return l; };

describe('any level: the Subway and office storeys without a tower field', () => {
  it('Subway (real generated station, no tower field / roof): the puff hurts the unprotected player through the one exposure, never the protected; expires; fast path again', () => {
    const L = subwayL(42);
    const {sys, step, stand, hits, uploads} = gasHost(L);
    expect(sys.field).toBe(null);
    expect(sys.roof).toBe(null);
    const g = L.levels[0].grid, [x, z] = openSpot(g);
    const y = g.floorAt(x, z);
    stand(x + 0.8, z, y);
    expect(sys.addPuff({id: 'sub', level: 0, x, y, z})).toBe(true);
    step(4);
    expect(sys.exposure.source).toBe('field');
    expect(sys.exposure.puff).toBeGreaterThan(GAS.THRESHOLD);
    expect(sys.exposure.dps).toBeCloseTo(dpsOf(sys.exposure.c), 6);
    expect(sys.hud.shown.tag).toBe('TOXIC GAS');
    const before = hits.length;
    sys.protection = () => true;
    step(1);
    expect(hits.length).toBe(before);
    expect(sys.exposure).toMatchObject({protected: true, dps: 0});
    sys.protection = () => false;
    step(PUFF.DURATION_S);
    expect(sys.puffs.active).toBe(false);
    expect(uploads.every(u => u.slot === 0)).toBe(true);
    const n = uploads.length;
    step(1);
    expect(uploads.length).toBe(n);
    expect(sys.hud.shown.tag).toBe('');
  });

  it('Office: the station level (0) and a tower floor with no breach yet both take a puff on their own storey', () => {
    const L = officeL(12345);
    const {sys, step, stand} = gasHost(L, true);
    expect(sys.field).not.toBe(null);
    expect(sys.field!.storeys).toEqual([]); // no breach: no tower storey field
    for (const lv of [0, 5]) {
      const g = L.levels[lv].grid, [x, z] = openSpot(g, 2);
      const y = g.floorAt(x, z);
      expect(sys.addPuff({id: `o${lv}`, level: lv, x, y, z}), `level ${lv}`).toBe(true);
      stand(x, z, y);
      step(3);
      expect(sys.exposure.c, `level ${lv}`).toBeGreaterThan(GAS.THRESHOLD);
      expect(sys.field!.storeys).toEqual([]); // the window-breach field is untouched
      step(PUFF.DURATION_S);
      expect(sys.puffs.active).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('overlap, bounds, lifecycle, the exposure / cough path, the fast path', () => {
  it('a puff inside a breach-filled room saturates at the cap (dps <= DPS_MAX); the breach field evolves exactly as without it; uploads stay <= 1', () => {
    const L = officeL(12345);
    const run = (withPuff: boolean) => {
      const t = gasHost(L, true);
      let pick: {id: string; x: number; z: number; level: number} | null = null;
      for (const ref of t.sys.windows!.refs.values()) {
        if (ref.plan.level !== 4) continue;
        const g = L.levels[4].grid, cells = sourceCells(ref, g);
        if (!cells.length || !/meeting|break|storage|exec|copy/i.test(L.areas[g.area[cells[0]]]?.label ?? '')) continue;
        const out = ref.plan.n[0] + ref.plan.n[1], a = (ref.pane.a0 + ref.pane.a1) / 2, c = ref.plan.inner - out * 1.5;
        pick = {id: ref.id, x: ref.plan.along === 'x' ? a : c, z: ref.plan.along === 'x' ? c : a, level: 4};
        break;
      }
      expect(pick).not.toBe(null);
      const base = L.levels[4].baseY;
      t.stand(pick!.x, pick!.z, base);
      t.sys.breakPane(pick!.id);
      t.step(40);
      if (withPuff) expect(t.sys.addPuff({id: 'p', level: 4, x: pick!.x, y: base, z: pick!.z})).toBe(true);
      let maxC = 0, maxDps = 0;
      for (let k = 0; k < 8 * 60; k++) { t.step(1 / 60); maxC = Math.max(maxC, t.sys.exposure.c); maxDps = Math.max(maxDps, t.sys.exposure.dps); }
      return {t, maxC, maxDps, field: Float32Array.from(t.sys.field!.storey(4)!.c)};
    };
    const a = run(true), b = run(false);
    expect(a.maxC).toBeLessThanOrEqual(GAS.CAP);
    expect(a.maxDps).toBeLessThanOrEqual(GAS.DPS_MAX + 1e-9);
    expect(a.maxC).toBeGreaterThanOrEqual(b.maxC); // never less gas with the puff
    expect(a.t.uploads.every(u => u.max <= 1)).toBe(true);
    expect(a.field).toEqual(b.field); // the breach field itself is unchanged by the puff (composed only at the eye / upload)
    expect(a.t.sys.windows!.state.size).toBe(b.t.sys.windows!.state.size);
  });

  it('bounded: at most MAX_PUFFS live (the oldest retires, its cells cleared once); a burst within COALESCE_M joins a live puff (re-armed, once)', () => {
    const P = new GasPuffs(), g = storey(0);
    P.world = {grid: lv => (lv === 0 ? g : null)};
    const a = P.add({id: 'a', level: 0, x: 15, y: 0, z: 5})!;
    P.advance(3);
    const ageA = a.age;
    expect(P.add({id: 'a2', level: 0, x: 16.5, y: 0, z: 5.5})).toBe(a); // joined
    expect(a.age).toBe(0);
    expect(ageA).toBeGreaterThan(2.9);
    expect(a.ids).toEqual(['a', 'a2']);
    expect(P.counts).toMatchObject({added: 1, joined: 1});
    for (const [i, x] of [[1, 22], [2, 27], [3, 31], [4, 13.5]] as const) P.add({id: `n${i}`, level: 0, x, y: 0, z: i % 2 ? 15 : 18}); // spread out
    expect(P.list.length).toBe(PUFF.MAX_PUFFS);
    expect(P.counts.retired).toBe(1);
    expect(P.list.includes(a)).toBe(false); // the oldest retired
    const changed = P.drainChanged();
    expect(changed.includes(a)).toBe(true); // its rect is uploaded once more (cleared by the caller)
    expect(P.drainChanged().includes(a)).toBe(false);
    // a point inside a solid cell snaps to the nearest open cell; deep inside solid: no puff
    expect(P.add({id: 'snap', level: 0, x: 9.1, y: 0, z: 7.4})).not.toBe(null); // the wall column x 18 (9..9.5 m) next to room A / corridor
    expect(P.add({id: 'solid', level: 0, x: 4.25, y: 0, z: 17.75})).toBe(null); // solid fill below room C, > 2 cells from any open cell
    expect(P.add({id: 'nolevel', level: 7, x: 15, y: 0, z: 5})).toBe(null);
  });

  it('lifecycle: teardown / a new section drop every puff (never saved: nothing re-emits on a revisit); a fresh build has none', () => {
    const L = synthLayout();
    const {h, sys, step} = gasHost(L);
    sys.addPuff({id: 'x', level: 0, x: 7, y: 0, z: 5});
    step(1);
    expect(sys.puffs.active).toBe(true);
    for (const s of h.sectionHooks) s.teardown?.();
    expect(sys.puffs.active).toBe(false);
    expect(sys.puffs.world).toBe(null);
    expect(sys.addPuff({id: 'between', level: 0, x: 7, y: 0, z: 5})).toBe(false); // between worlds: nothing
    h.sectionHooks[0].build!(L);
    expect(sys.puffs.active).toBe(false);
    step(1);
    expect(sys.exposure.c).toBe(0);
  });

  it('the cough feedback follows the puff exposure: unprotected in the cloud -> coughs; protected -> silent, no damage', () => {
    for (const masked of [false, true]) {
      const L = synthLayout();
      const t = gasHost(L);
      const coughs: number[] = [];
      let now = 0;
      const host = {state: 'playing', player: t.h.player, gas: t.sys, sfx: {cough: () => { coughs.push(now); return 1.2; }, stopCough: () => {}}, frameHooks: t.h.frameHooks, stateListeners: t.h.stateListeners,
        runParticipants: [] as unknown[], sectionHooks: t.h.sectionHooks};
      installCough(host as never);
      t.sys.protection = () => masked;
      t.stand(22, 11);
      t.sys.addPuff({id: 'c', level: 0, x: 22, y: 0, z: 11});
      for (let k = 0; k < 8 * 60; k++) { now += 1 / 60; t.step(1 / 60); }
      if (masked) { expect(coughs).toHaveLength(0); expect(t.hits).toHaveLength(0); }
      else { expect(coughs.length).toBeGreaterThan(0); expect(t.hits.length).toBeGreaterThan(0); }
    }
  });

  it('absent-source fast path: no field, no roof, no puff -> the frame returns at its first check (no ticks, uploads or exposure work)', () => {
    const L = subwayL(42);
    const {sys, step, uploads} = gasHost(L);
    let samples = 0;
    const orig = sys.puffs.concentrationAt.bind(sys.puffs);
    sys.puffs.concentrationAt = (x, y, z) => { samples++; return orig(x, y, z); };
    step(5);
    expect(samples).toBe(0);
    expect(uploads).toHaveLength(0);
    expect(sys.puffs.counts.ticks).toBe(0);
    expect(sys.puffs.tick(1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('volumetric gas layer: the puff is drawn in its storey layer, and the gate closes again when every layer is clean', () => {
  it('setGasLayer counts non-zero bytes: a puff upload opens the gate, its clearing upload closes it; a breach-style layer keeps it open', () => {
    const r = {initialized: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, toneMappingExposure: MOOD.exposure,
      xr: {enabled: false}, debug: {onShaderError: null}, shadowMap: {enabled: true, type: THREE.PCFShadowMap},
      backend: {isWebGLBackend: true, extensions: {has: () => true}}, getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720), setRenderTarget: () => {}, render: () => {}};
    const flashlight = new THREE.SpotLight(0xffffff, 1, 30, 0.58);
    const a = new VolumetricAtmosphere(r as never, {flashlight}, 'high');
    a.setSize(640, 360);
    a.setStation(subwayL(42), null);
    expect(a.gasDebug().on).toBe(false);
    const rect = {x0: 40, y0: 50, w: 3, h: 2};
    a.setGasLayer(0, [0, 0.3, 0.6, 0.2, 0.1, 0], rect);
    expect(a.gasDebug().on).toBe(true);
    a.setGasLayer(0, [0, 0, 0, 0, 0, 0], rect); // the expired puff's clearing upload
    expect(a.gasDebug().on).toBe(false);
    a.setGasLayer(0, [0.5], {x0: 10, y0: 10, w: 1, h: 1}); // another layer region still has gas
    a.setGasLayer(0, [0.4, 0, 0, 0, 0, 0], rect);
    a.setGasLayer(0, [0, 0, 0, 0, 0, 0], rect);
    expect(a.gasDebug().on).toBe(true);
    a.dispose();
  });
});
