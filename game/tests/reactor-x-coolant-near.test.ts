// Task reactor-playtest-round2-20261102 (lane COOLANT): THE COOLANT NEAR LOD — user: "coolant should look more like gooop flowing
// through pipes! its a little flat right now. You can use the current look for far away rendering but switch to a high detail at close
// ish range." (world/reactor/coolantNear.ts; the far look stays coreLiquids.ts's sleeves / glasses.)
//  1. the pieces on REAL layouts: one per far sleeve piece / sight glass / spool window, each window on its run's line (the flow runs on
//     through the spool), the near tubes on the far sleeves' axes and frames;
//  2. the near / far switch: hysteresis (ON < on, OFF > off, no thrash), re-decided only after `move`, the dither fade's outer radius
//     never reaches an inactive piece (the far look never fades where no near instance exists) — dense eye paths over real core floors;
//  3. state gating through CoreVisuals.setRestartState: no near layer before the valve, still goop once pressurised (the near clock does
//     not run), flowing with the pump (the clock follows the pump's spool-up), frozen while play is paused (no tick), instant restore;
//     the coolant's blue light is unchanged;
//  4. the material compiles on both backends with at most 12 uniform buffers per stage (WebGPU's default; three r186: every uniformArray
//     is its own buffer — none here), no texture, and the far materials gain no buffer;
//  5. the draw budget: 0 away from the coolant / before the valve, at most 2 near it, bounded instances / triangles on real poses.
// LL_COOLANT_OUT=/tmp/x.txt writes the numbers (vitest hides console output).
import {appendFileSync, writeFileSync} from 'node:fs';
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GLSLNodeBuilder, WGSLNodeBuilder, type WebGPURenderer} from 'three/webgpu';
import {generateReactorLevel, CORE_LEVEL} from '../src/gen/reactor/index';
import {planReactorKit} from '../src/world/reactor/archKit';
import {REACTOR_MODELS, REACTOR_PIECES} from '../src/world/reactor/archAssets';
import {coreHeroOf, type CoreHeroLayout} from '../src/world/reactor/coreHero';
import {buildCoreLiquids, type CoreBuilt} from '../src/world/reactor/coreLiquids';
import {CoreVisuals} from '../src/world/reactor/coreVisuals';
import {CORE_LOOK, coreLook, coreStageTargets} from '../src/world/reactor/coreStages';
import {COOLANT_NEAR, CoolantNearLod, coolantNearPieces, nearPieceDistance, nearWeightAt, type NearPiece} from '../src/world/reactor/coolantNear';
import {emptyReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {setAttributeInstancing} from '../src/render/instancing';
import {rendererFor} from './helpers/fogCompile';
import type {StationLayout} from '../src/gen/stationTypes';

const OUT = process.env.LL_COOLANT_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const SEEDS = [9100, 637474];
const layouts = new Map<number, StationLayout>();
const L = (seed: number) => { let x = layouts.get(seed); if (!x) { x = generateReactorLevel({levelSeed: seed}); layouts.set(seed, x); } return x; };
/** The hero as the game plans it (every model delivered: elbows / spools / CRDM platform; spools carry the windows). */
const heroOf = (seed: number): CoreHeroLayout => coreHeroOf(planReactorKit(L(seed).reactor!, {models: new Set(REACTOR_PIECES), fixtures: true}))!;
const built = new Map<number, CoreBuilt>();
const coreOf = (seed: number): CoreBuilt => {
  let b = built.get(seed);
  if (!b) { b = buildCoreLiquids(heroOf(seed), L(seed).levels[CORE_LEVEL].grid, new THREE.MeshStandardMaterial(), [CORE_LEVEL, CORE_LEVEL - 1]); built.set(seed, b); }
  return b;
};
const state = (o: Partial<ReactorRunState> = {}): ReactorRunState => ({...emptyReactorState(3, 3), ...o});
const PUMPING = state({fuses: [true, true], breaker: true, valve: true, pump: true});
const V = (x: number, y: number, z: number) => ({x, y, z});

/** Eyes over the core floor: a grid over the ring / pool rails / outer floor at standing height, plus the tier above. */
function coreEyes(seed: number): {x: number; y: number; z: number}[] {
  const cf = L(seed).reactor!.coreFloor!, eyes: {x: number; y: number; z: number}[] = [];
  for (let r = cf.vesselR + 0.6; r <= cf.pool.r1 + 6; r += 0.9) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 1.1));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      for (const h of [1.62, 7.6]) eyes.push(V(cf.x + Math.cos(a) * r, cf.y + h, cf.z + Math.sin(a) * r));
    }
  }
  return eyes;
}

describe('the near pieces on real layouts', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: one per far sleeve piece / sight glass / spool window; windows on their run; tubes on the far sleeves' frames`, () => {
      const hero = heroOf(seed), core = coreOf(seed), pieces = coolantNearPieces(hero);
      const by = (k: number) => pieces.filter(p => p.kind === k);
      expect(by(0).length).toBe(core.stats.flowSegments);
      expect(by(1).length).toBe(hero.glasses.length);
      expect(by(2).length).toBe(hero.windows.length);
      expect(hero.windows.length).toBeGreaterThanOrEqual(3);
      // every spool window found the run it is cut into: its bore axis is on that run's line, its run position between the two cuts
      const SP = REACTOR_MODELS.sightGlassSpool.anchors as unknown as {len: number; windowW: number};
      for (const w of by(2)) {
        expect(w.seed, 'window matched to a flow').toBeLessThan(hero.flows.length);
        const f = hero.flows[w.seed], mid = {x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2, z: (w.a.z + w.b.z) / 2};
        const onRun = f.segs!.some(q => {
          const L = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y, q.b.z - q.a.z), u = {x: (q.b.x - q.a.x) / L, y: (q.b.y - q.a.y) / L, z: (q.b.z - q.a.z) / L};
          const rx = mid.x - q.a.x, ry = mid.y - q.a.y, rz = mid.z - q.a.z, t = rx * u.x + ry * u.y + rz * u.z;
          return Math.hypot(rx - u.x * t, ry - u.y * t, rz - u.z * t) < 0.03;
        });
        expect(onRun, 'bore axis on the run line').toBe(true);
        const sMid = w.s0 + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y, w.b.z - w.a.z) / 2;
        const ends = f.segs!.map(q => q.s0 + Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y, q.b.z - q.a.z));
        expect(ends.some(e => sMid > e && sMid - e < SP.len)).toBe(true); // just past a cut: inside the spool's gap
        expect(w.r).toBeCloseTo(f.d / 2);
      }
      // the near tubes sit on the far sleeves: same axis endpoints and the same frame (the windows sit where the slots do)
      const near = core.near!;
      expect(near).toBeTruthy();
      const flowPos = core.flow!.geometry.attributes.position;
      const p0 = by(0)[0], tube0 = new THREE.Vector3().fromBufferAttribute(flowPos, 0);
      // the far sleeve's first vertex: a + e1 * (r + 0.014) — the near tube's first vertex: a + e1 * (r + 0.016) on the same ray
      const d0 = tube0.clone().sub(new THREE.Vector3(p0.a.x, p0.a.y, p0.a.z));
      expect(d0.length()).toBeCloseTo(p0.r + 0.014, 4);
      near.lod.reset();
      near.update(p0.a); // (pressure 0: hidden, but the instance data is written)
      const m = new THREE.Matrix4();
      near.tubes.mesh.getMatrixAt(0, m);
      const v = new THREE.Vector3(1, 0, 0).applyMatrix4(m).sub(new THREE.Vector3(p0.a.x, p0.a.y, p0.a.z));
      expect(v.length()).toBeCloseTo(p0.r + 0.016, 4);
      expect(v.normalize().dot(d0.normalize())).toBeGreaterThan(0.9999);
      out(`seed ${seed}: pieces ${pieces.length} (pipe ${by(0).length}, glass ${by(1).length}, window ${by(2).length}), near tube cap ${near.stats.tubeCap}, triangles at cap ${near.stats.triangles}`);
    }, 120_000);
  }
});

describe('the near / far switch: hysteresis, bounded, never fades the far look without a near instance', () => {
  const piece: NearPiece = {kind: 0, a: V(0, 0, 0), b: V(4, 0, 0), r: 0.37, s0: 0, k: 1, seed: 0};
  it('one pipe: ON inside `on`, stays ON until beyond `off`, no thrash across the band, skips small eye moves', () => {
    const lod = new CoolantNearLod([piece]);
    const at = (d: number) => V(2, 0, d + piece.r + 0.06); // nearPieceDistance = d
    expect(nearPieceDistance(piece, at(10))).toBeCloseTo(10);
    lod.decide(at(30));
    expect(lod.active[0]).toBe(0);
    expect(lod.r1).toBe(0); // nothing near: the far look everywhere
    lod.decide(at(COOLANT_NEAR.on + 0.2));
    expect(lod.active[0]).toBe(0);
    lod.decide(at(COOLANT_NEAR.on - 0.2));
    expect(lod.active[0]).toBe(1);
    expect(lod.r1).toBeCloseTo(COOLANT_NEAR.full + COOLANT_NEAR.band);
    // back out through the hysteresis band: stays on
    lod.decide(at(COOLANT_NEAR.off - 0.3));
    expect(lod.active[0]).toBe(1);
    // oscillating inside the band never toggles
    const changes = lod.counts.changes;
    for (let k = 0; k < 40; k++) lod.decide(at(k % 2 ? COOLANT_NEAR.on - 0.5 : COOLANT_NEAR.off - 0.5));
    expect(lod.counts.changes).toBe(changes);
    lod.decide(at(COOLANT_NEAR.off + 0.3));
    expect(lod.active[0]).toBe(0);
    expect(lod.r1).toBe(0);
    // a move under `move` is not re-decided
    const decided = lod.counts.decided;
    lod.decide(V(2, 0.1, COOLANT_NEAR.off + 0.3 + piece.r + 0.06));
    expect(lod.counts.decided).toBe(decided);
    expect(lod.counts.skipped).toBeGreaterThan(0);
    // the tunables keep the invariant: the fade ends inside `on` with the move + guard margin
    expect(COOLANT_NEAR.full + COOLANT_NEAR.band + COOLANT_NEAR.move + COOLANT_NEAR.guard).toBeLessThanOrEqual(COOLANT_NEAR.on);
    expect(COOLANT_NEAR.off - COOLANT_NEAR.on).toBeGreaterThanOrEqual(2);
  });

  it('the cross-fade is smooth (no step): near weight 1 inside `full`, 0 beyond full + band, continuous and monotonic between', () => {
    const r1 = COOLANT_NEAR.full + COOLANT_NEAR.band, r0 = COOLANT_NEAR.full;
    expect(nearWeightAt(r0 - 0.01, r0, r1)).toBe(1);
    expect(nearWeightAt(r1 + 0.01, r0, r1)).toBe(0);
    let prev = 1;
    for (let d = r0; d <= r1; d += 0.05) { const w = nearWeightAt(d, r0, r1); expect(w).toBeLessThanOrEqual(prev + 1e-9); expect(prev - w).toBeLessThan(0.03); prev = w; }
    for (let d = 0; d < 30; d += 0.5) expect(nearWeightAt(d, 0, 0)).toBe(0); // r1 = 0: no near pixel anywhere
  });

  it('over the cap: the nearest stay, the fade shrinks inside the first dropped piece', () => {
    const many: NearPiece[] = Array.from({length: 12}, (_, i) => ({...piece, a: V(0, 0, i * 0.8), b: V(4, 0, i * 0.8)}));
    const lod = new CoolantNearLod(many, 5);
    lod.decide(V(2, 0, -2));
    expect(lod.count[0]).toBe(5);
    expect(lod.counts.capped).toBe(1);
    for (let i = 0; i < many.length; i++) if (!lod.active[i]) expect(lod.dist[i]).toBeGreaterThanOrEqual(lod.r1 + COOLANT_NEAR.move + COOLANT_NEAR.guard - 1e-6);
    expect([...lod.active.slice(0, 5)]).toEqual([1, 1, 1, 1, 1]);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: dense eye paths over the core floor — invariant holds, the cap never binds, bounded active set`, () => {
      const pieces = coolantNearPieces(heroOf(seed)), lod = new CoolantNearLod(pieces);
      let maxTubes = 0, maxWin = 0, near = 0, eyes = 0;
      for (const e of coreEyes(seed)) {
        lod.decide(e, true);
        eyes++;
        maxTubes = Math.max(maxTubes, lod.count[0]); maxWin = Math.max(maxWin, lod.count[1]);
        if (lod.r1 > 0) near++;
        for (let i = 0; i < pieces.length; i++) {
          if (lod.active[i]) continue;
          // an inactive piece: every fragment of its near geometry is beyond the fade (even after an undecided move): far only
          expect(nearPieceDistance(pieces[i], e)).toBeGreaterThan(lod.r1 + COOLANT_NEAR.move);
        }
      }
      expect(lod.counts.capped).toBe(0);
      expect(maxTubes).toBeLessThanOrEqual(COOLANT_NEAR.tubeCap * 0.75); // headroom (seeds peak ~40-45)
      expect(near).toBeGreaterThan(eyes * 0.5); // the core floor is mostly in near range of some coolant
      out(`seed ${seed}: ${eyes} core-floor eyes, near active at ${near}; peak active tubes ${maxTubes} / ${COOLANT_NEAR.tubeCap}, windows ${maxWin}`);
    }, 120_000);
  }
});

describe('state gating (CoreVisuals.setRestartState): off before the valve, still once pressurised, flowing with the pump, paused', () => {
  const run = (v: CoreVisuals, s: number, dt = 0.05) => { for (let t = 0; t < s - 1e-9; t += dt) v.tick(dt); };

  it('dormant / fuses / breaker: no near layer (hidden, no draw, the far look everywhere) even beside a pipe', () => {
    const core = coreOf(SEEDS[0]), near = core.near!, v = new CoreVisuals(core, heroOf(SEEDS[0]));
    const p = near.pieces.find(q => q.kind === 0)!;
    for (const s of [state(), state({fuses: [true, true]}), state({fuses: [true, true], breaker: true})]) {
      v.setRestartState(s, true);
      near.lod.reset();
      v.lod(p.a);
      run(v, 1);
      expect(near.state().draws).toBe(0);
      expect(near.tubes.mesh.visible).toBe(false);
      expect(near.fade.r1.value).toBe(0);
      expect(near.clock.value).toBe(0);
      expect(near.lod.count[0]).toBeGreaterThan(0); // decided (ready for the valve), just not shown
    }
  });

  it('the valve: the loop fills (the near zone grows out from the eye, no pop), then STILL goop — the clock does not run', () => {
    const core = coreOf(SEEDS[0]), near = core.near!, v = new CoreVisuals(core, heroOf(SEEDS[0]));
    const p = near.pieces.find(q => q.kind === 0)!;
    v.setRestartState(state({fuses: [true, true], breaker: true}), true);
    near.lod.reset();
    v.lod(p.a);
    v.setRestartState(state({fuses: [true, true], breaker: true, valve: true}), false);
    let prev = -1;
    const full = COOLANT_NEAR.full + COOLANT_NEAR.band;
    for (let k = 0; k < 40; k++) {
      v.tick(0.05);
      v.lod(p.a);
      const r1 = near.fade.r1.value;
      expect(r1).toBeGreaterThanOrEqual(prev); // grows, never jumps back
      expect(r1 - Math.max(prev, 0)).toBeLessThan(full * 0.25); // no switch-on pop (eased over the first ~1 s of the fill)
      prev = r1;
    }
    expect(near.fade.r1.value).toBeCloseTo(full);
    expect(near.state().draws).toBeGreaterThanOrEqual(1);
    run(v, 4);
    expect(v.level.pressure).toBe(1);
    expect(core.uniforms.fill.value).toBe(1);
    expect(near.clock.value).toBe(0); // pressurised, not flowing: still
  });

  it('the pump: the goop flows, its clock follows the pump spool-up (4 s) at the near speed; paused play (no tick) freezes it', () => {
    const core = coreOf(SEEDS[0]), near = core.near!, v = new CoreVisuals(core, heroOf(SEEDS[0]));
    v.setRestartState(state({fuses: [true, true], breaker: true, valve: true}), true);
    near.clock.value = 0;
    v.setRestartState(PUMPING, false);
    run(v, 1);
    const c1 = near.clock.value;
    // the flow eases in over 4 s: after 1 s, ~0.125 of the full-speed distance (the integral of a linear ramp)
    const fullSpeed = CORE_LOOK.flowSpeed * COOLANT_NEAR.speed;
    expect(c1).toBeGreaterThan(fullSpeed * 0.08);
    expect(c1).toBeLessThan(fullSpeed * 0.2);
    run(v, 4);
    const c2 = near.clock.value;
    run(v, 1);
    expect(near.clock.value - c2).toBeCloseTo(fullSpeed, 1); // at full flow: ~1.3 m/s along the centreline
    expect(fullSpeed).toBeLessThan(CORE_LOOK.flowSpeed * 0.5); // goop: well under the far dashes' 3.2 m/s
    // paused: Game.update (and with it the frame hooks) does not run -> no tick; a zero / bad dt changes nothing either
    const frozen = near.clock.value;
    v.tick(0);
    v.tick(NaN);
    expect(near.clock.value).toBe(frozen);
    // an instant restore of a pumping record runs straight away (nothing to replay), and setRestartState itself moves no clock
    const w = new CoreVisuals(core, heroOf(SEEDS[0]));
    near.clock.value = 0;
    w.setRestartState(PUMPING, true);
    expect(near.clock.value).toBe(0);
    w.tick(0.5);
    expect(near.clock.value).toBeCloseTo(fullSpeed * 0.5, 3);
    // the blue light the coolant casts is the stage look's, untouched by the near layer
    expect(w.lightLook().blue).toBeCloseTo(coreLook(coreStageTargets(PUMPING)).blue);
  });
});

/** Compile `mesh`'s material with the backend's node builder (stubbed renderer: no GPU). */
function compileMesh(mesh: THREE.Mesh, backend: 'glsl' | 'wgsl'): {vertex: string; fragment: string} {
  const r = rendererFor(backend) as WebGPURenderer;
  // the uninitialised WebGPU backend has no device: its uniform-buffer limit at WebGPU's default binding size (64 KiB)
  const caps = (r.backend as unknown as {capabilities?: {getUniformBufferLimit(): number; llStub?: boolean}}).capabilities;
  if (caps && !caps.llStub) { const f = caps.getUniformBufferLimit.bind(caps); caps.getUniformBufferLimit = () => { try { return f(); } catch { return 65536; } }; caps.llStub = true; }
  const B = (backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder) as unknown as new (o: THREE.Object3D, r: WebGPURenderer) => {
    scene: THREE.Scene; camera: THREE.Camera; build(): void; vertexShader?: string; fragmentShader?: string;
  };
  const scene = new THREE.Scene();
  const parent = mesh.parent;
  scene.add(mesh);
  const b = new B(mesh, r);
  const camera = new THREE.PerspectiveCamera();
  b.scene = scene;
  b.camera = camera;
  // the scene's (empty) lights node, as the renderer hands it to every build (helpers/nodeCompile.ts)
  const lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene, c: THREE.Camera): {setLights(l: THREE.Light[]): void}}}).lighting.getNode(scene, camera);
  lightsNode.setLights([]);
  (b as unknown as {lightsNode: unknown}).lightsNode = lightsNode;
  b.build();
  scene.remove(mesh);
  if (parent) parent.add(mesh);
  return {vertex: b.vertexShader ?? '', fragment: b.fragmentShader ?? ''};
}
const ubos = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/var<uniform>/g) ?? []).length : (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length;
const texs = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length : (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length;

describe('the near material: both backends, inside WebGPU\'s 12 uniform buffers per stage, no texture; the far materials gain no buffer', () => {
  let core: CoreBuilt;
  beforeAll(() => { core = coreOf(SEEDS[0]); });
  it('compiles (tubes / windows, attribute instancing on and off) with <= 12 uniform buffers per stage and no texture', () => {
    const near = core.near!;
    for (const backend of ['glsl', 'wgsl'] as const) {
      for (const attr of [true, false]) {
        setAttributeInstancing(attr);
        try {
          for (const mesh of [near.tubes.mesh, near.windows!.mesh]) {
            // a fresh InstancedMesh of the same geometry / material (three keys every InstancedMesh by itself)
            const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.max(1, mesh.count));
            const c = compileMesh(im, backend);
            if (process.env.LL_COOLANT_SHADER) writeFileSync(`${process.env.LL_COOLANT_SHADER}-${mesh.name}-${backend}-${attr}.txt`, `${c.vertex}\n//----\n${c.fragment}`);
            expect(c.fragment.length).toBeGreaterThan(1000);
            for (const [stage, src] of [['vertex', c.vertex], ['fragment', c.fragment]] as const) {
              const u = ubos(src, backend);
              out(`near ${mesh.name} ${backend} attr=${attr} ${stage}: uniform buffers ${u}, textures ${texs(src, backend)}`);
              expect(u, `${backend} ${stage} uniform buffers`).toBeLessThanOrEqual(12);
              expect(texs(src, backend), `${backend} ${stage} textures`).toBe(0);
            }
          }
        } finally {
          setAttributeInstancing(false);
        }
      }
      // the far materials (the dither fade added): still no texture, no more uniform buffers than the near material's
      const nearFrag = ubos(compileMesh(new THREE.InstancedMesh(near.tubes.mesh.geometry, near.tubes.mesh.material, 2), backend).fragment, backend);
      for (const far of [core.flow!, core.glass!]) {
        const c = compileMesh(new THREE.Mesh(far.geometry, far.material), backend);
        const u = ubos(c.fragment, backend);
        out(`far ${far.name} ${backend}: fragment uniform buffers ${u}, textures ${texs(c.fragment, backend)}`);
        expect(u).toBeLessThanOrEqual(nearFrag);
        expect(u).toBeLessThanOrEqual(12);
        expect(texs(c.fragment, backend)).toBe(0);
      }
    }
  }, 120_000);

  it('one shared material, plain uniforms, never a shadow caster; the far sleeves / glasses cut out by the same fade', () => {
    const near = core.near!;
    expect(near.tubes.mesh.material).toBe(near.material);
    expect(near.windows!.mesh.material).toBe(near.material);
    expect(near.material.alphaTest).toBeGreaterThan(0);
    expect(near.tubes.mesh.castShadow).toBe(false);
    for (const far of [core.flow!, core.glass!]) expect((far.material as THREE.Material).alphaTest).toBeGreaterThan(0); // the dither cut
    expect(core.group.children.length).toBeLessThanOrEqual(5); // the far layer unchanged; the near layer is its own group
    expect(near.group.children.length).toBe(2);
  });
});

describe('draw budget per representative pose (real layouts)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: 0 draws away from the coolant (rim, mid tiers) and before the valve; <= 2 near it; bounded instances`, () => {
      const lay = L(seed), R = lay.reactor!, core = coreOf(seed), near = core.near!, v = new CoreVisuals(core, heroOf(seed));
      v.setRestartState(PUMPING, true);
      const cf = R.coreFloor!;
      // the CPU-submit test's representative poses (rim gallery, rim down to the core, the tier-2 deck) and the core floor
      const far: {name: string; e: {x: number; y: number; z: number}}[] = [];
      const rim = R.decks.filter(d => d.level === 0 && d.kind === 'gallery');
      for (const d of rim.slice(0, 3)) far.push({name: `rim ${d.kind}`, e: V((d.rect.x0 + d.rect.x1) / 2, d.y + 1.62, (d.rect.z0 + d.rect.z1) / 2)});
      const t2 = R.tiers.find(t => t.index === 2) ?? R.tiers[2];
      for (const d of R.decks.filter(q => q.level === t2.level).slice(0, 3)) far.push({name: `tier-2 ${d.kind}`, e: V((d.rect.x0 + d.rect.x1) / 2, d.y + 1.62, (d.rect.z0 + d.rect.z1) / 2)});
      for (const p of far) {
        near.lod.reset();
        v.lod(p.e);
        out(`seed ${seed} ${p.name}: near draws ${near.draws()} (tubes ${near.lod.count[0]}, windows ${near.lod.count[1]})`);
        if (p.name.startsWith('rim')) expect(near.draws(), p.name).toBe(0);
        else expect(near.draws(), p.name).toBeLessThanOrEqual(2);
      }
      // the core floor: the ring, bridges, outer floor round every loop
      let worst = 0, inst = 0, poses = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const r of [(cf.ring.r0 + cf.ring.r1) / 2, cf.pool.r1 + 1.5]) {
          near.lod.reset();
          v.lod(V(cf.x + Math.cos(a) * r, cf.y + 1.62, cf.z + Math.sin(a) * r));
          worst = Math.max(worst, near.draws());
          inst = Math.max(inst, near.tubes.mesh.count + (near.windows?.mesh.count ?? 0));
          poses++;
        }
      }
      expect(worst).toBeLessThanOrEqual(2);
      expect(worst).toBeGreaterThanOrEqual(1);
      expect(inst).toBeLessThanOrEqual(COOLANT_NEAR.tubeCap + near.stats.windows);
      // the whole near layer at capacity: a few thousand triangles (the far layer is under 60k)
      expect(near.stats.triangles).toBeLessThan(8000);
      // before the valve the same poses draw nothing
      v.setRestartState(state({fuses: [true, true], breaker: true}), true);
      near.lod.reset();
      v.lod(V(cf.x + (cf.ring.r0 + cf.ring.r1) / 2, cf.y + 1.62, cf.z));
      expect(near.draws()).toBe(0);
      out(`seed ${seed}: core floor ${poses} poses: near draws worst ${worst}, peak instances ${inst}; near triangles at capacity ${near.stats.triangles}`);
    }, 120_000);
  }
});
