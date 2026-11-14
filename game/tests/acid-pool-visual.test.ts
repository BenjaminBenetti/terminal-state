// Task studio-flamethrower-fire-20261114-031614-01 (lane ACID-VFX; user: "Upgrade Acid Scrapper's big green circle into an organic
// convincing corrosive pool: reactive foam, bubbles, layered detail, irregular edges, NOT a generic disk. VISUAL ONLY: preserve
// existing 3-bio/5-output, 10-second duration, damage, salvage, fixed-versus-portable immunity mechanics."): the acid pool's LOOK.
// Node tests over the real modules:
//  - the OUTLINE (weapons/acidPoolShape.ts): seeded, lobed, and inside the band about 0.86 .. 1.0 of the radius that hurts for every
//    seed and angle — what looks like acid hurts, what hurts looks like acid;
//  - the FILM (weapons/acidPoolLook.ts, the one function the node material is built from, run on numbers): drawn only inside the
//    circle inPool tests, liquid out to the band at every angle, readable in the dark, yellow-green, layered (deep body, bright
//    streaks, edge foam), slowly flowing; reaction blooms; drying in stages with the pool's strength, nothing gone in one frame;
//  - the BEADS (weapons/acidPoolVisual.ts): bubbles that swell, wobble and pop into spits, froth, gathered at the edge and at the
//    reaction points, bounded, always inside the film;
//  - determinism per pool seed, the system's random stream drawn exactly as before the look existed, and the reaction hook being a
//    look only (the same burn outcomes with the look switched off);
//  - rendering rules: fixed slots reused (clear() / drying release them, nothing is created per pool), every mesh a pool draws is a
//    warm prototype, transparent FrontSide without depth write, no lights / shadows, clean WGSL + GLSL builds with few uniform
//    buffers, an A/B on three's real WebGPURenderer over a no-op device (0 node builds / 0 pipelines for pools after the warm-up),
//    and nothing named like a gas.
// Node only: generated shader text and three's JavaScript on a no-op device — no pixel was drawn by a GPU here. How it reads in the
// game is a browser spot check; ACID_POOL_PREVIEW=<dir> writes CPU previews of the film and beads (tests/helpers/acidPoolPreview.ts).
import {mkdirSync, readFileSync} from 'node:fs';
import * as THREE from 'three';
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {mulberry32} from '../src/core/rng';
import {levelsOf} from '../src/gen/levels';
import {ACID_GRENADE} from '../src/items/grenades';
import {Inventory} from '../src/items/inventory';
import {PhysicsSystem} from '../src/physics/world';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {WarmupRegistry, drawsTwoPass, planWarmup, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {ACID_LOOK, LOOK_TILE, lookState, poolLookAt, poolNoiseTile} from '../src/weapons/acidPoolLook';
import {POOL_EDGE, poolEdge, poolShape, ringRadius} from '../src/weapons/acidPoolShape';
import {ACID_FX, AcidPoolVisual, AcidPoolVisuals, POOL_LIFT} from '../src/weapons/acidPoolVisual';
import {ACID, GRENADE, GrenadeSystem, acidPoolRig, inPool, poolReach, poolStrength, throwOneGrenade, type AcidMeltLike, type AcidPool, type GrenadeEnemy, type MeltRefLike} from '../src/weapons/grenades';
import {renderTop, renderView, type PreviewPool} from './helpers/acidPoolPreview';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {FIX, levelFixture} from './helpers/levelFixture';
import {buildBoth} from './helpers/tslShaders';

const TAU = Math.PI * 2;
const DT = 1 / 60;
const SEEDS = [0, 1, 2, 3, 0xffffffff, ...Array.from({length: 400}, (_, i) => Math.imul(i + 1, 2654435761) >>> 0)];
const BEADS = ACID_FX.count.bubbles + ACID_FX.count.froth + ACID_FX.count.spits;

afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

/** A system of pools on their own (the QA rig) with a seeded stream. */
const rigOf = (seed: number) => { const group = new THREE.Group(); return {group, sys: acidPoolRig(group, mulberry32(seed))}; };
/** The film at a world point of a live pool, as its shader computes it (null: nothing is drawn there). */
const filmAt = (p: AcidPool, x: number, z: number) => { const reach = poolReach(p); return poolLookAt(p.look.look, ACID.color, (x - p.x) / reach, (z - p.z) / reach); };
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** A slot's uniforms (private): what the GPU is handed. */
const uniformsOf = (v: AcidPoolVisual) => (v as unknown as {u: {state: {value: THREE.Vector4}; flow: {value: THREE.Vector2}; react: {value: THREE.Vector3}[]}}).u;
/** The pool slots' meshes among a system's warm prototypes. */
const slotMeshes = (sys: GrenadeSystem) => sys.warmPrototypes().filter(o => /^acid-pool/.test(o.name)) as THREE.Mesh[];

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the outline: an irregular spill inside the circle that hurts', () => {
  it('every seed, every angle: POOL_EDGE.min <= edge x (1 - fringe) and edge <= POOL_EDGE.max (about 0.86 .. 1.0 of poolReach)', () => {
    expect([POOL_EDGE.min, POOL_EDGE.max]).toEqual([0.86, 1]);
    // (the shader frays and softens the liquid's last `fringe` inside the edge: the band holds for what is DRAWN)
    expect(ACID_LOOK.fray + ACID_LOOK.soft).toBeCloseTo(POOL_EDGE.fringe, 12);
    let lo = Infinity, hi = -Infinity;
    for (const seed of SEEDS) {
      const s = poolShape(seed);
      for (let i = 0; i < 1440; i++) {
        const e = poolEdge(s, (i + 0.37) / 1440 * 3 * TAU - TAU); // (three turns, negative angles too)
        if (e < lo) lo = e;
        if (e > hi) hi = e;
      }
    }
    expect(lo * (1 - POOL_EDGE.fringe)).toBeGreaterThanOrEqual(POOL_EDGE.min);
    expect(hi).toBeLessThanOrEqual(POOL_EDGE.max);
    expect(lo).toBeGreaterThanOrEqual(POOL_EDGE.lo);
    expect(hi).toBeLessThanOrEqual(POOL_EDGE.hi);
    // the mesh's polyline through the spokes (what is drawn exactly) keeps it too: a chord sags a hair inside the curve
    for (const seed of SEEDS.slice(0, 60)) {
      const ring = lookState(poolShape(seed), 1.5).ring;
      expect(ring.length).toBe(POOL_EDGE.segments);
      for (let i = 0; i < ring.length; i++) expect(ringRadius(ring, i / ring.length * TAU)).toBeCloseTo(ring[i], 6);
      for (let i = 0; i < 2000; i++) {
        const r = ringRadius(ring, (i + 0.5) / 2000 * 2 * TAU - TAU);
        if (r * (1 - POOL_EDGE.fringe) < POOL_EDGE.min || r > POOL_EDGE.max) throw new Error(`seed ${seed}: polyline radius ${r}`);
      }
    }
  });

  it('is no disc: every pool uses the whole band in several lobes and bays; periodic; the same seed is the same spill, another seed another', () => {
    const rings = new Set<string>();
    for (const seed of SEEDS) {
      const s = poolShape(seed);
      const v = Array.from({length: 720}, (_, i) => poolEdge(s, i / 720 * TAU));
      const min = Math.min(...v), max = Math.max(...v), mean = v.reduce((a, b) => a + b, 0) / v.length;
      const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      // lobes: local maxima in the outer part of the band
      let lobes = 0;
      for (let i = 0; i < 720; i++) if (v[i] > v[(i + 719) % 720] && v[i] >= v[(i + 1) % 720] && v[i] > POOL_EDGE.lo + 0.3 * (POOL_EDGE.hi - POOL_EDGE.lo)) lobes++;
      expect(max - min, `seed ${seed}: range`).toBeGreaterThan(0.95 * (POOL_EDGE.hi - POOL_EDGE.lo));
      expect(std, `seed ${seed}: spread`).toBeGreaterThan(0.012);
      expect(lobes, `seed ${seed}: lobes`).toBeGreaterThanOrEqual(5);
      expect(poolEdge(s, 1.234 + TAU)).toBeCloseTo(poolEdge(s, 1.234), 9);
      expect(poolEdge(s, -2.5 - 3 * TAU)).toBeCloseTo(poolEdge(s, -2.5), 9);
      // smooth enough for the mesh: neighbouring spokes never differ by more than a third of the band
      const ring = lookState(s, 1.5).ring;
      for (let i = 0; i < ring.length; i++) expect(Math.abs(ring[i] - ring[(i + 1) % ring.length])).toBeLessThan((POOL_EDGE.hi - POOL_EDGE.lo) / 3);
      rings.add(Array.from(ring).join());
      const again = poolShape(seed);
      expect([Array.from(again.waves), Array.from(again.notches), again.lo, again.span]).toEqual([Array.from(s.waves), Array.from(s.notches), s.lo, s.span]);
    }
    expect(rings.size).toBe(new Set(SEEDS).size);
  });

  it('the film mesh: its rim vertices sit on the outline, an outer ring on the unit circle, every face up, nothing beyond radius 1', () => {
    const looks = new AcidPoolVisuals(new THREE.Group(), 1, ACID.color);
    const v = looks.slots[0], n = POOL_EDGE.segments;
    for (const seed of [7, 99, 123456789]) {
      v.place(3, 1, -2, 1.5, seed);
      const shape = poolShape(seed), pos = v.mesh.geometry.getAttribute('position'), rim = v.mesh.geometry.getAttribute('aRim');
      expect(pos.count).toBe(1 + 2 * n);
      expect([pos.getX(0), pos.getY(0), pos.getZ(0), rim.getX(0)]).toEqual([0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, e = poolEdge(shape, a);
        expect(Math.hypot(pos.getX(1 + i), pos.getZ(1 + i))).toBeCloseTo(e, 6);
        expect(Math.atan2(pos.getZ(1 + i), pos.getX(1 + i))).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 5);
        expect(Math.hypot(pos.getX(1 + n + i), pos.getZ(1 + n + i))).toBeCloseTo(1, 6);
        expect([pos.getY(1 + i), pos.getY(1 + n + i), rim.getX(1 + i), rim.getX(1 + n + i)]).toEqual([0, 0, 1, 2]);
      }
      const idx = v.mesh.geometry.index!;
      expect(idx.count).toBe(n * 9);
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let t = 0; t < idx.count; t += 3) {
        A.fromBufferAttribute(pos, idx.getX(t)); B.fromBufferAttribute(pos, idx.getX(t + 1)); C.fromBufferAttribute(pos, idx.getX(t + 2));
        expect(B.sub(A).cross(C.sub(A)).y, `triangle ${t / 3}`).toBeGreaterThan(0); // (FrontSide, seen from above)
      }
      expect([v.mesh.geometry.boundingSphere!.radius, v.mesh.geometry.boundingSphere!.center.length()]).toEqual([1, 0]);
      expect(v.mesh.position.toArray().map(x => +x.toFixed(6))).toEqual([3, 1 + POOL_LIFT, -2]);
      expect(v.bubbles.position.toArray()).toEqual(v.mesh.position.toArray());
    }
    expect(POOL_LIFT).toBe(0.012);
    looks.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the film: what looks like acid hurts, what hurts looks like acid', () => {
  it('a live pool, growing and full: the film is drawn only where inPool is true, and is liquid out to the band at every angle', () => {
    const {sys} = rigOf(21);
    const p = sys.addPool(4, 2, -3);
    const ages = [0, 0.1, 0.2, ACID.fadeIn, 1.5, 4, 7.9];
    let checked = 0;
    for (const age of ages) {
      while (p.age < age - 1e-9) sys.tick(DT);
      const reach = poolReach(p), k = poolStrength(p);
      expect(p.mesh.scale.toArray()).toEqual([reach, reach, reach]);
      for (let i = 0; i < 360; i++) {
        const a = (i + 0.41) / 360 * TAU, c = Math.cos(a), s = Math.sin(a);
        // outside the circle that hurts: nothing
        for (const f of [1.0005, 1.02, 1.3]) {
          expect(inPool(p, p.x + c * reach * f, p.y, p.z + s * reach * f)).toBe(false);
          expect(filmAt(p, p.x + c * reach * f, p.z + s * reach * f)).toBeNull();
        }
        // inside: something is drawn everywhere (film or its etched fringe), and it is in the pool
        for (const f of [0.999, 0.93, 0.6, 0.2]) {
          expect(inPool(p, p.x + c * reach * f, p.y, p.z + s * reach * f)).toBe(true);
          expect(filmAt(p, p.x + c * reach * f, p.z + s * reach * f)).not.toBeNull();
        }
        // liquid, at the pool's strength, right up to the band's inner edge
        const at = filmAt(p, p.x + c * reach * POOL_EDGE.min * 0.999, p.z + s * reach * POOL_EDGE.min * 0.999)!;
        expect(at.alpha, `age ${age}, angle ${i}`).toBeGreaterThanOrEqual(ACID_LOOK.alphaRim * k - 1e-9);
        expect(at.liquid).toBeGreaterThan(0.65);
        // the visible edge (walking in from the circle: the first clearly liquid point) lies in the band
        let rho = 0.9995;
        for (; rho > 0.5; rho -= 0.0025) { const f = filmAt(p, p.x + c * reach * rho, p.z + s * reach * rho)!; if (f.liquid > 0.5 && f.alpha >= 0.4 * k) break; }
        if (k > 0.2) { expect(rho, `age ${age}, angle ${i}: edge`).toBeGreaterThanOrEqual(POOL_EDGE.min); expect(rho).toBeLessThanOrEqual(POOL_EDGE.max); }
        // past the liquid's own edge only the etched fringe is left (no liquid colour), fading toward the circle
        const e = ringRadius(p.look.look.ring, a);
        const fringe = filmAt(p, p.x + c * reach * (e + 0.004), p.z + s * reach * (e + 0.004));
        if (fringe) { expect(fringe.liquid).toBeLessThan(0.01); expect(fringe.alpha).toBeLessThanOrEqual(ACID_LOOK.alphaEtch + 1e-9); }
        const last = filmAt(p, p.x + c * reach * 0.9995, p.z + s * reach * 0.9995)!;
        expect(last.alpha).toBeLessThan(0.02);
        checked++;
      }
    }
    expect(checked).toBe(ages.length * 360);
  });

  it('what the GPU is handed is what the CPU film reads: the uniforms mirror the pool every frame; opacity = ACID_LOOK.opacity x poolStrength', () => {
    const {sys} = rigOf(5);
    const p = sys.addPool(0, 0, 0);
    expect(p.mat).toBe(p.look.mat);
    expect([p.mesh, p.bubbles]).toEqual([p.look.mesh, p.look.bubbles]);
    const u = uniformsOf(p.look);
    for (let f = 0; f < 60 * 10 - 2; f++) {
      if (f === 100) p.look.react(0.4, 0.3, 1);
      sys.tick(DT);
      const L = p.look.look, dry = Math.max(0, Math.min(1, 1 - p.left / ACID.fadeOut));
      expect(p.mat.opacity).toBeCloseTo(ACID_LOOK.opacity * poolStrength(p), 12);
      expect([L.t, L.k, L.dry, L.r]).toEqual([p.age, poolStrength(p), dry, ACID.poolR]);
      expect(u.state.value.toArray()).toEqual([L.t, L.dry, L.r, L.swirl]);
      expect(u.flow.value.toArray()).toEqual([L.ox, L.oz]);
      u.react.forEach((r, i) => { for (let c = 0; c < 3; c++) expect(r.value.getComponent(c)).toBeCloseTo(L.react[i * 3 + c], 6); });
      expect(p.mesh.scale.x).toBe(poolReach(p));
    }
    expect(ACID_LOOK.opacity).toBe(0.82);
    expect(u.react.length).toBe(ACID_LOOK.reactions);
  });

  it('acid green-yellow and layered, not a flat colour: deep body, bright streaks, edge foam, wet and matte, slowly flowing; it glows enough to read in the dark', () => {
    for (const seed of SEEDS.slice(5, 17)) {
      const st = lookState(poolShape(seed), ACID.poolR);
      st.t = 3;
      const later = {...st, t: 4};
      let n = 0, foam = 0, inner = 0, innerFoam = 0, outer = 0, outerFoam = 0, body = 0, change = 0, s1 = 0, s2 = 0, aMin = 9, aMax = 0, slope = 0, glowMin = 9, glowMax = 0;
      const rgb = [0, 0, 0], rough = {liquid: 0, foam: 0, nl: 0, nf: 0};
      for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) {
        const qx = x / 40, qz = y / 40, f = poolLookAt(st, ACID.color, qx, qz);
        if (!f || f.liquid < 0.5) continue;
        const rho = Math.hypot(qx, qz) / ringRadius(st.ring, Math.atan2(qz, qx)), isFoam = f.foam > 0.5;
        n++;
        if (isFoam) { foam++; rough.foam += f.rough; rough.nf++; } else if (f.foam < 0.1) { body++; for (let c = 0; c < 3; c++) rgb[c] += f.rgb[c]; rough.liquid += f.rough; rough.nl++; }
        if (rho > 0.88) { outer++; if (isFoam) outerFoam++; } else if (rho < 0.6) { inner++; if (isFoam) innerFoam++; }
        const L = lum(f.rgb);
        s1 += L; s2 += L * L;
        aMin = Math.min(aMin, f.alpha); aMax = Math.max(aMax, f.alpha);
        slope += Math.hypot(f.sx, f.sz);
        glowMin = Math.min(glowMin, f.glow[1]); glowMax = Math.max(glowMax, f.glow[1]);
        change += Math.abs(lum(poolLookAt(later, ACID.color, qx, qz)!.rgb) - L);
      }
      const mean = rgb.map(c => c / body), spread = Math.sqrt(s2 / n - (s1 / n) ** 2), tag = `seed ${seed}`;
      // yellow-green: green leads, red well up, hardly any blue
      expect(mean[1], tag).toBeGreaterThan(mean[0] * 1.25);
      expect(mean[0], tag).toBeGreaterThan(mean[1] * 0.4);
      expect(mean[2], tag).toBeLessThan(mean[1] * 0.15);
      // layered: a wide spread of brightness, thin translucent film next to a nearly opaque body
      expect(spread, tag).toBeGreaterThan(0.1);
      expect(aMin, tag).toBeLessThan(0.62);
      expect(aMax, tag).toBeGreaterThan(0.9);
      // foam: some, far more of it along the edge than in the middle
      expect(foam / n, tag).toBeGreaterThan(0.04);
      expect(foam / n, tag).toBeLessThan(0.3);
      expect(outerFoam / outer, tag).toBeGreaterThan(3 * (innerFoam / inner) + 0.1);
      // wet liquid (glossy), matte foam, a rippled surface for the lights to catch
      expect(rough.liquid / rough.nl, tag).toBeLessThan(0.15);
      expect(rough.foam / rough.nf, tag).toBeGreaterThan(0.5);
      expect(slope / n, tag).toBeGreaterThan(0.02);
      // a modest glow everywhere on the liquid (no light needed to see where it is), never a lamp
      expect(glowMin, tag).toBeGreaterThan(0.02);
      expect(glowMax, tag).toBeLessThan(0.3);
      // it flows: a second later the film has moved, slowly
      expect(change / n, tag).toBeGreaterThan(0.01);
      expect(change / n, tag).toBeLessThan(0.15);
    }
  });

  it('in the dark the glow alone still shows the hazard out to the band, at every angle', () => {
    for (const seed of SEEDS.slice(0, 40)) for (const t of [0.4, 3, 7.5]) {
      const st = lookState(poolShape(seed), ACID.poolR);
      st.t = t;
      for (let i = 0; i < 180; i++) {
        const a = (i + 0.31) / 180 * TAU;
        const f = poolLookAt(st, ACID.color, Math.cos(a) * POOL_EDGE.min * 0.999, Math.sin(a) * POOL_EDGE.min * 0.999)!;
        expect(f.glow[1] * f.alpha, `seed ${seed} t ${t} angle ${i}`).toBeGreaterThan(0.02);
        expect(f.glow[1]).toBeGreaterThan(f.glow[2] * 5); // (green, not white)
      }
    }
  });

  it('the noise tile is data, not art: 128 px RGBA, deterministic, every channel using the full range', () => {
    const t = poolNoiseTile();
    expect(t.length).toBe(LOOK_TILE * LOOK_TILE * 4);
    expect(LOOK_TILE).toBe(128);
    expect(poolNoiseTile()).toBe(t);
    for (let c = 0; c < 4; c++) {
      let lo = 255, hi = 0, sum = 0;
      for (let i = c; i < t.length; i += 4) { lo = Math.min(lo, t[i]); hi = Math.max(hi, t[i]); sum += t[i]; }
      expect([lo, hi]).toEqual([0, 255]);
      const mean = sum / (LOOK_TILE * LOOK_TILE) / 255;
      expect(mean).toBeGreaterThan(c === 2 ? 0.15 : 0.35);
      expect(mean).toBeLessThan(0.65);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('reactions: foam where the acid is working', () => {
  /** Mean foam weight / green glow of the film within `r` m of a world point. */
  const around = (p: AcidPool, x: number, z: number, r = 0.12) => {
    let foam = 0, glow = 0, n = 0;
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
      const dx = i / 4 * r, dz = j / 4 * r;
      if (dx * dx + dz * dz > r * r) continue;
      const f = filmAt(p, x + dx, z + dz)!;
      foam += f.foam; glow += f.glow[1]; n++;
    }
    return {foam: foam / n, glow: glow / n};
  };

  it('react(x, z, amount) blooms foam and glow at that world point, follows the body, and is gone about two seconds after it leaves', () => {
    const {sys} = rigOf(8);
    const p = sys.addPool(10, 0, 20);
    for (let f = 0; f < 180; f++) sys.tick(DT); // (the burst's own bloom is over)
    expect(p.look.stats().reactions).toBe(0);
    // a quiet spot of open liquid
    let spot: {x: number; z: number} | null = null;
    for (let i = 0; i < 400 && !spot; i++) {
      const a = i * 2.39996, d = 0.25 + 0.6 * ((i * 0.618) % 1), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (around(p, x, z).foam < 0.05) spot = {x, z};
    }
    expect(spot).not.toBeNull();
    const before = around(p, spot!.x, spot!.z), reacts0 = p.look.counts.reacts;
    for (let f = 0; f < 30; f++) { p.look.react(spot!.x, spot!.z, 1); sys.tick(DT); }
    const during = around(p, spot!.x, spot!.z);
    expect(during.foam).toBeGreaterThan(0.6);
    expect(during.foam).toBeGreaterThan(before.foam + 0.5);
    expect(during.glow).toBeGreaterThan(before.glow * 0.9); // (foam is pale, but the bloom is not darker than the liquid was)
    expect(p.look.counts.reacts - reacts0).toBe(30);
    expect(p.look.stats().reactions).toBe(1); // (one point, refreshed: not thirty)
    const R = p.look.look.react;
    const i0 = [0, 1, 2, 3, 4, 5].find(i => R[i * 3 + 2] > 0)!;
    expect([R[i0 * 3], R[i0 * 3 + 1]].map(v => +v.toFixed(4))).toEqual([+(spot!.x - p.x).toFixed(4), +(spot!.z - p.z).toFixed(4)]);
    expect(R[i0 * 3 + 2]).toBeCloseTo(Math.exp(-ACID_FX.react.decay * DT), 6);
    // it decays: about a third after half a second, nothing after two
    for (let f = 0; f < 30; f++) sys.tick(DT);
    expect(R[i0 * 3 + 2]).toBeCloseTo(Math.exp(-ACID_FX.react.decay * 31 * DT), 4);
    for (let f = 0; f < 90; f++) sys.tick(DT);
    expect(p.look.stats().reactions).toBe(0);
    expect(around(p, spot!.x, spot!.z).foam).toBeLessThan(before.foam + 0.1);
  });

  it('points stay inside the film, merge when close, and never exceed ACID_LOOK.reactions; a free slot ignores them', () => {
    const looks = new AcidPoolVisuals(new THREE.Group(), 1, ACID.color);
    const v = looks.slots[0];
    v.react(0, 0, 1); // (free: ignored)
    expect(v.counts.reacts).toBe(0);
    v.place(0, 0, 0, 1.5, 4242);
    v.update(0, 1, 1.5, 1, 0);
    for (let f = 0; f < 240; f++) v.update(DT, 1 + f * DT, 1.5, 1, 0); // (the burst's own bloom fades)
    expect(v.stats().reactions).toBe(0);
    // far outside: pulled onto the film, `inset` x the edge
    v.react(40, 30, 1);
    const R = v.look.react, a = Math.atan2(30, 40);
    expect(Math.hypot(R[0], R[1])).toBeCloseTo(ringRadius(v.look.ring, a) * ACID_FX.react.inset * 1.5, 4);
    expect(Math.atan2(R[1], R[0])).toBeCloseTo(a, 5);
    // a second call near it merges (the stronger amount is kept); a distant one takes another slot
    v.react(40 * 0.9, 30 * 0.9, 0.4);
    expect(v.stats().reactions).toBe(1);
    expect(R[2]).toBe(1);
    v.react(-0.5, 0.2, 0.7);
    expect(v.stats().reactions).toBe(2);
    // more distinct points than slots: bounded, the weakest give way to stronger ones
    for (let i = 0; i < 20; i++) v.react(Math.cos(i) * 1.1, Math.sin(i) * 1.1, 0.5 + i * 0.02);
    expect(v.stats().reactions).toBe(ACID_LOOK.reactions);
    expect(R.length).toBe(ACID_LOOK.reactions * 3);
    for (let i = 0; i < ACID_LOOK.reactions; i++) {
      const rho = Math.hypot(R[i * 3], R[i * 3 + 1]);
      expect(rho).toBeLessThanOrEqual(ringRadius(v.look.ring, Math.atan2(R[i * 3 + 1], R[i * 3])) * 1.5 + 1e-6);
    }
    v.react(0.3, 0.3, 0); v.react(0.3, 0.3, -2); v.react(0.3, 0.3, NaN);
    expect(v.stats().reactions).toBe(ACID_LOOK.reactions);
    // while the film is still spreading a point keeps its place IN the film (the film scales as a whole)
    v.release();
    v.place(0, 0, 0, 1.5, 4242);
    v.update(0, 0, 0.6, 0, 0);
    v.react(0.3, 0, 1);
    const j = [0, 1, 2, 3, 4, 5].find(i => Math.abs(v.look.react[i * 3] - 0.75) < 1e-5);
    expect(j).not.toBeUndefined(); // (0.3 m at a reach of 0.6 m = half way out = 0.75 m of the full 1.5 m)
    looks.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the beads: bubbles, froth and spits', () => {
  /** Seven seconds of a pool, optionally with a body standing in it from the first second; what its beads did. */
  function watch(react: boolean, seed = 9) {
    const {sys} = rigOf(seed);
    const p = sys.addPool(0, 0, 0);
    const P = {x: 0.6, z: -0.5}, m = p.bubbles.instanceMatrix.array as Float32Array, nb = ACID_FX.count.bubbles;
    let all = 0, near = 0, band = 0, outside = 0, wobble = 0, maxLive = 0;
    const first = new Float32Array(nb), peak = new Float32Array(nb), growth: number[] = [], sizes: number[] = [];
    for (let f = 0; f < 60 * 7; f++) {
      if (react && f > 60) p.look.react(P.x, P.z, 1);
      sys.tick(DT);
      const reach = poolReach(p), B = p.look.beads(), s = p.look.stats();
      expect(s.bubbles).toBeLessThanOrEqual(ACID_FX.count.bubbles);
      expect(s.froth).toBeLessThanOrEqual(ACID_FX.count.froth);
      expect(s.spits).toBeLessThanOrEqual(ACID_FX.count.spits);
      maxLive = Math.max(maxLive, B.length);
      for (const b of B) {
        const rho = Math.hypot(b.x, b.z), e = ringRadius(p.look.look.ring, Math.atan2(b.z, b.x)) * reach;
        // the whole bead inside the film (bubbles, froth) / the circle that hurts (a spit in flight)
        if (rho + b.r > (b.kind === 'spit' ? reach : e) + 1e-6) outside++;
        if (b.kind === 'spit' || f <= 60) continue;
        all++;
        if (Math.hypot(b.x - P.x, b.z - P.z) < 0.35) near++;
        if (rho > 0.75 * e) band++;
      }
      // each bubble's life: its first radius, its largest, and whether it ever went out of round (wobble)
      for (let i = 0; i < nb; i++) {
        const sx = m[i * 16], sz = m[i * 16 + 10];
        if (sx > 0) {
          if (first[i] === 0) first[i] = sx;
          peak[i] = Math.max(peak[i], sx);
          if (Math.abs(sx - sz) > 0.02 * sx) wobble++;
        } else if (first[i] > 0) { growth.push(peak[i] / first[i]); sizes.push(peak[i]); first[i] = peak[i] = 0; }
      }
    }
    sizes.sort((a, b) => a - b);
    growth.sort((a, b) => a - b);
    return {p, all, near: near / all, band: band / all, outside, wobble, maxLive, growth, sizes, counts: {...p.look.counts}};
  }

  it('bounded and inside the film; bubbles of many sizes swell, wobble and pop into spits; more of them along the edge', () => {
    const w = watch(false);
    expect(w.outside).toBe(0);
    expect(w.p.bubbles.count).toBe(BEADS);
    expect(w.p.bubbles.instanceMatrix.count).toBe(BEADS);
    expect(w.maxLive).toBeLessThanOrEqual(BEADS);
    expect(w.maxLive).toBeGreaterThan(15);
    // they swell: a finished bubble peaked at several times its first size (most of them; a pool-end cut is not in this window)
    expect(w.growth.length).toBeGreaterThan(25);
    expect(w.growth[Math.floor(w.growth.length * 0.2)]).toBeGreaterThan(2.5);
    // varied: the biggest blisters several times the smallest bubbles
    expect(w.sizes[w.sizes.length - 1] / w.sizes[0]).toBeGreaterThan(2.5);
    expect(w.sizes[w.sizes.length - 1]).toBeLessThan(ACID_FX.bubble.size[1] * 1.5);
    expect(w.wobble).toBeGreaterThan(100);
    // they pop, and the bigger ones spit (beyond the burst's own crown)
    expect(w.counts.pops).toBeGreaterThan(25);
    expect(w.counts.spits).toBeGreaterThan(ACID_FX.splash.spits + 10);
    expect(w.counts.froth).toBeGreaterThan(w.counts.bubbles);
    // gathered along the edge: three quarters of them in the outer band that is under half the area
    expect(w.band).toBeGreaterThan(0.6);
    expect(w.near).toBeLessThan(0.08);
  });

  it('a body standing in the pool: the bubbling doubles and gathers around it', () => {
    const quiet = watch(false), busy = watch(true);
    expect(busy.outside).toBe(0);
    expect(busy.near).toBeGreaterThan(0.25);
    expect(busy.near).toBeGreaterThan(quiet.near * 5);
    expect(busy.counts.bubbles + busy.counts.froth).toBeGreaterThan(1.6 * (quiet.counts.bubbles + quiet.counts.froth));
    expect(busy.maxLive).toBeLessThanOrEqual(BEADS);
  });

  it('a long frame never dumps a burst of beads; a hitch does not pile up a backlog', () => {
    const {sys} = rigOf(3);
    const p = sys.addPool(0, 0, 0);
    for (let f = 0; f < 60; f++) sys.tick(DT);
    const before = {...p.look.counts};
    sys.tick(1.5); // (one very long frame)
    expect(p.look.counts.bubbles - before.bubbles).toBeLessThanOrEqual(ACID_FX.maxPerFrame);
    expect(p.look.counts.froth - before.froth).toBeLessThanOrEqual(ACID_FX.maxPerFrame);
    const mid = {...p.look.counts};
    sys.tick(DT);
    expect(p.look.counts.bubbles - mid.bubbles).toBeLessThanOrEqual(1);
    expect(p.look.counts.froth - mid.froth).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('determinism: the same pool looks the same every time', () => {
  /** A pool's whole look after a fixed script. */
  function script(seed: number, guard = false) {
    const {sys} = rigOf(seed);
    sys.warmPrototypes(); // (everything three is made here, before the pool)
    const spy = guard ? vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random used'); }) : null;
    const p = sys.addPool(1, 0, 2);
    for (let f = 0; f < 60 * 6; f++) {
      if (f > 100 && f < 260) p.look.react(1.5, 2.3, 1);
      if (f === 300) p.look.react(0.4, 1.6, 1.6);
      sys.tick(DT);
    }
    spy?.mockRestore();
    const L = p.look.look;
    return {ring: Array.from(L.ring), state: [L.t, L.dry, L.k, L.r, L.ox, L.oz, L.swirl], react: Array.from(L.react),
      matrices: Array.from(p.bubbles.instanceMatrix.array), bead: Array.from((p.bubbles.geometry.getAttribute('aBead') as THREE.BufferAttribute).array),
      counts: {...p.look.counts}, rim: Array.from(p.mesh.geometry.getAttribute('position').array)};
  }

  it('same stream, same script: identical outline, film state, reactions and every bead; no Math.random, and nothing three is created for a pool', () => {
    const a = script(31, true), b = script(31);
    expect(a).toEqual(b);
    expect(a.counts.bubbles).toBeGreaterThan(40);
    const c = script(32);
    expect(c.ring).not.toEqual(a.ring);
    expect(c.matrices).not.toEqual(a.matrices);
  });

  it('the look is seeded from the pool\'s own draws: two pools of one system differ; a reused slot carries nothing over', () => {
    const {sys} = rigOf(77);
    const p1 = sys.addPool(0, 0, 0), p2 = sys.addPool(5, 0, 0);
    expect(Array.from(p1.look.look.ring)).not.toEqual(Array.from(p2.look.look.ring));
    expect([p1.look.look.ox, p1.look.look.oz]).not.toEqual([p2.look.look.ox, p2.look.look.oz]);
    // a slot used by another pool first, then by seed 555 == a fresh slot with seed 555
    const run = (dirty: boolean) => {
      const looks = new AcidPoolVisuals(new THREE.Group(), 1, ACID.color), v = looks.slots[0];
      if (dirty) {
        v.place(9, 9, 9, 1.5, 1234);
        for (let f = 0; f < 200; f++) { v.react(9.5, 9.2, 1); v.update(DT, f * DT, 1.5, 1, 0); }
        v.release();
      }
      v.place(0, 0, 0, 1.5, 555);
      for (let f = 0; f < 200; f++) { if (f > 50) v.react(0.5, 0.2, 1); v.update(DT, f * DT, Math.min(1.5, 0.6 + f * 0.05), Math.min(1, f / 18), 0); }
      const out = {ring: Array.from(v.look.ring), react: Array.from(v.look.react), m: Array.from(v.bubbles.instanceMatrix.array), counts: {...v.counts}, stats: v.stats()};
      looks.dispose();
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('a pool\'s life: it spreads with poolReach, dries with poolStrength, and its slot is reused', () => {
  /** How much of the circle is liquid (the mean liquid weight) / the strongest opacity anywhere / the share of spokes whose outline is still marked. */
  const census = (p: AcidPool) => {
    let any = 0, wet = 0, amax = 0, marked = 0;
    for (let y = -24; y <= 24; y++) for (let x = -24; x <= 24; x++) {
      const f = poolLookAt(p.look.look, ACID.color, x / 24, y / 24);
      if (!f) continue;
      any++;
      wet += f.liquid;
      amax = Math.max(amax, f.alpha);
    }
    for (let i = 0; i < 90; i++) {
      const a = (i + 0.5) / 90 * TAU, e = ringRadius(p.look.look.ring, a) * 0.97;
      if (poolLookAt(p.look.look, ACID.color, Math.cos(a) * e, Math.sin(a) * e)!.alpha > 0.03) marked++;
    }
    return {wet: wet / any, amax, marked: marked / 90};
  };

  it('at the burst the film starts small and faint and follows poolReach / poolStrength to full size in ACID.fadeIn', () => {
    const {sys} = rigOf(13);
    const p = sys.addPool(2, 3, 4);
    expect(p.mesh.scale.x).toBeCloseTo(0.4 * ACID.poolR, 12);
    expect(p.mat.opacity).toBe(0);
    expect([p.mesh.visible, p.bubbles.visible, p.look.inUse]).toEqual([true, true, true]);
    expect(p.look.stats().spits).toBe(ACID_FX.splash.spits); // (the burst's crown)
    expect(p.look.stats().reactions).toBe(1); // (and its bite where it landed)
    let prev = p.mesh.scale.x, prevOp = 0;
    for (let f = 0; f < 30; f++) {
      sys.tick(DT);
      expect(p.mesh.scale.x).toBe(poolReach(p));
      expect(p.mesh.scale.x).toBeGreaterThanOrEqual(prev);
      expect(p.mat.opacity).toBeGreaterThanOrEqual(prevOp);
      expect(p.mesh.scale.x - prev).toBeLessThan(0.6 * ACID.poolR * DT / ACID.fadeIn + 1e-9); // (it spreads, it does not jump)
      prev = p.mesh.scale.x; prevOp = p.mat.opacity;
    }
    expect(prev).toBe(ACID.poolR);
    expect(prevOp).toBeCloseTo(ACID_LOOK.opacity, 12);
    expect(census(p).wet).toBeGreaterThan(0.8);
  });

  it('drying: over ACID.fadeOut the bubbling dies down, the thin film goes, the liquid retreats into its lobes, the outline stays marked — nothing vanishes in one frame', () => {
    const {sys, group} = rigOf(3);
    const p = sys.addPool(0, 0, 0);
    const children = group.children[0].children.length;
    while (p.left > ACID.fadeOut + DT) sys.tick(DT);
    const full = census(p);
    expect(full.wet).toBeGreaterThan(0.8);
    expect(p.look.stats().bubbles + p.look.stats().froth).toBeGreaterThan(5);
    let prev = full, prevOp = p.mat.opacity, frames = 0, maxLoss = 0, halfWet = -1, lateBeads = 0, markedLate = 1;
    while (sys.pools.length) {
      sys.tick(DT);
      if (!sys.pools.length) break;
      frames++;
      const c = census(p), dry = p.look.look.dry;
      expect(c.wet, `left ${p.left}`).toBeLessThanOrEqual(prev.wet + 0.005); // (it only retreats)
      maxLoss = Math.max(maxLoss, prev.wet - c.wet);
      expect(prevOp - p.mat.opacity).toBeLessThanOrEqual(ACID_LOOK.opacity * DT / ACID.fadeOut + 1e-9);
      expect(prev.amax - c.amax).toBeLessThan(0.05);
      if (halfWet < 0 && dry >= 0.5) halfWet = c.wet;
      if (dry > ACID_FX.dry.fade[1]) lateBeads = Math.max(lateBeads, p.look.beads().length);
      if (dry > 0.3 && dry < 0.85) markedLate = Math.min(markedLate, c.marked);
      prev = c; prevOp = p.mat.opacity;
    }
    expect(frames).toBeGreaterThan(ACID.fadeOut / DT - 4); // (drawn until the pool is gone, not cut short)
    expect(maxLoss).toBeLessThan(0.05); // (no frame loses more than a small part of the pool: at its fastest a twentieth)
    expect(halfWet).toBeGreaterThan(0.25); // (half way through drying the lobes are still liquid…)
    expect(halfWet).toBeLessThan(0.6); // (…and the thin film is gone)
    expect(lateBeads).toBe(0); // (no bead on the dry stain)
    expect(markedLate).toBeGreaterThan(0.9); // (the etched outline still shows where it hurts)
    expect(prev.amax).toBeLessThan(0.15); // (the last frame is nearly nothing: the end is no pop)
    // gone: the slot is hidden and free, nothing was removed from or added to the scene
    expect([p.mesh.visible, p.bubbles.visible, p.look.inUse, p.mat.opacity]).toEqual([false, false, false, 0]);
    expect(sys.counts.poolsDried).toBe(1);
    expect(group.children[0].children.length).toBe(children);
    expect(p.look.beads()).toEqual([]);
  });

  it('clear() and drying release the slots: hidden, emptied, reused by the next pools; never more slots than the acid cap', () => {
    const {sys, group} = rigOf(41);
    const protos = sys.warmPrototypes();
    const slots = slotMeshes(sys);
    expect(slots.length).toBe(ACID.maxPools * 2);
    expect(slots.every(m => m.visible === false && m.parent === group.children[0])).toBe(true);
    const children = group.children[0].children.length;
    const pools = [sys.addPool(0, 0, 0), sys.addPool(4, 0, 0), sys.addPool(8, 1, 0)];
    for (let f = 0; f < 120; f++) { pools[1].look.react(4.3, 0.2, 1); sys.tick(DT); }
    const ids = (list: readonly THREE.Object3D[]) => list.map(o => o.uuid).sort();
    expect(ids(pools.flatMap(p => [p.mesh, p.bubbles]))).toEqual(ids(slots));
    expect(slots.every(m => m.visible)).toBe(true);
    expect(pools[1].look.stats().reactions).toBeGreaterThan(0);
    sys.clear();
    expect(sys.pools.length).toBe(0);
    for (const p of pools) {
      expect([p.mesh.visible, p.bubbles.visible, p.look.inUse, p.mat.opacity]).toEqual([false, false, false, 0]);
      expect(p.look.stats()).toEqual({bubbles: 0, froth: 0, spits: 0, reactions: 0});
      const m = p.bubbles.instanceMatrix.array;
      for (let i = 0; i < BEADS; i++) expect(m[i * 16] + m[i * 16 + 5] + m[i * 16 + 10]).toBe(0);
      expect(uniformsOf(p.look).react.every(r => r.value.z === 0)).toBe(true);
    }
    expect(group.children[0].children.length).toBe(children);
    sys.tick(DT); // (a cleared system ticks to nothing)
    expect(slots.every(m => !m.visible)).toBe(true);
    // the next pools draw with the very same objects, materials, geometries and buffers
    const made = slots.map(m => [m.uuid, (m.material as THREE.Material).uuid, m.geometry.uuid]);
    const buffers = slots.map(m => (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).instanceMatrix.array : m.geometry.getAttribute('position').array);
    const next = [sys.addPool(1, 0, 1), sys.addPool(2, 0, 2), sys.addPool(3, 0, 3)];
    for (let f = 0; f < 200; f++) sys.tick(DT);
    expect(ids(next.flatMap(p => [p.mesh, p.bubbles]))).toEqual(ids(slots));
    expect(slotMeshes(sys).map(m => [m.uuid, (m.material as THREE.Material).uuid, m.geometry.uuid])).toEqual(made);
    expect(slots.map(m => (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).instanceMatrix.array : m.geometry.getAttribute('position').array).every((b, i) => b === buffers[i])).toBe(true);
    expect(group.children[0].children.length).toBe(children);
    expect(sys.warmPrototypes().length).toBe(protos.length);
    // the three pools dry on their own: all slots free again
    for (let f = 0; f < 60 * 10; f++) sys.tick(DT);
    expect([sys.pools.length, sys.counts.poolsDried]).toEqual([0, 3]);
    expect(slots.every(m => !m.visible)).toBe(true);
    expect(next[0].mesh.position.y).toBeCloseTo(POOL_LIFT, 12);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The look changes nothing a pool DOES

const fx = levelFixture();
const L = levelsOf(fx);

function fakeZombie(x: number, y: number, z: number, hp = 100) {
  const brain = {
    alive: true, x, y, z, hp, hits: [] as number[],
    damage(amount: number) {
      if (!this.alive) return false;
      this.hits.push(amount);
      this.hp -= amount;
      if (this.hp <= 0) { this.alive = false; return true; }
      return false;
    },
  };
  return {brain, hitFlash: 0, get hitVolumes() { return brain.alive ? [{part: 'torso' as const, a: {x: brain.x, y: brain.y + 0.9, z: brain.z}, b: {x: brain.x, y: brain.y + 1.55, z: brain.z}, r: 0.28}] : []; }};
}

/**
 * Three acid grenades thrown in a real station's physics world: zombies in and out of the first pool (one dies in it), the player
 * standing in it, a prop it eats — everything the pool DOES, logged, with every draw from the system's random stream counted.
 */
function scenario() {
  const ph = new PhysicsSystem(null);
  ph.build(fx);
  let draws = 0;
  const base = mulberry32(11);
  const sys = new GrenadeSystem(new THREE.Group(), ph, () => { draws++; return base(); });
  const player = {x: 21, y: FIX.upperY, z: 4, alive: true, hp: 100, takeDamage(a: number) { this.hp -= a; if (this.hp <= 0) this.alive = false; }};
  const log: unknown[] = [];
  let zs: ReturnType<typeof fakeZombie>[] = [];
  const ref: MeltRefLike = {key: 'prop:7', x: 0, y: 0, z: 0, label: 'crate'};
  const melted: unknown[] = [];
  const melt: AcidMeltLike = {
    atPoint: () => null,
    inDisc: (x, _y, z, r) => (Math.hypot(x - ref.x, z - ref.z) <= r + 0.5 ? [ref] : []),
    expose: (r, dt) => { melted.push(['expose', r.key, dt]); return true; },
    start: r => { melted.push(['start', r.key]); return true; },
    alive: () => true,
    where: (r, out) => { out.x = r.x; out.y = r.y; out.z = r.z; return true; },
  };
  const kills: number[] = [], pain: number[] = [], hurt: number[] = [];
  sys.env = {
    zombies: () => zs as unknown as GrenadeEnemy[], player: () => player,
    kill: (z, dir, _p, strength) => { kills.push(zs.indexOf(z as never), +dir.y.toFixed(6), strength); },
    hurt: z => { hurt.push(zs.indexOf(z as never)); }, playerHurt: a => { pain.push(a); }, melt: () => melt,
    levelAt: (x, z, y) => L.levelAt(x, z, y), lineOfSight: (a, b) => L.lineOfSight(a, b),
  };
  const inv = new Inventory();
  inv.add(inv.makeStack(ACID_GRENADE, 5));
  const eye = {x: 21, y: FIX.upperY + 1.62, z: 4};
  const dirOf = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return {x: x / l, y: y / l, z: z / l}; };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { ph.update(DT); sys.tick(DT); } };
  const toss = (d: {x: number; y: number; z: number}) => throwOneGrenade(sys, ACID_GRENADE, () => inv.take(ACID_GRENADE, 1) === 1, () => inv.count(ACID_GRENADE) > 0, eye, d);
  const until = (n: number) => { let k = 0; while (sys.pools.length < n && k++ < 900) step(); return k; };

  const d0 = draws;
  expect(toss(dirOf(0, -0.35, 1)).ok).toBe(true);
  const perThrow = draws - d0;
  log.push(['frames1', until(1)]);
  const perPool = draws - d0 - perThrow;
  const p = sys.pools[0];
  log.push(['pool1', p.x, p.y, p.z, p.left, p.age, p.r, Array.from(p.seeds)]);
  ref.x = p.x + 1.2; ref.y = p.y; ref.z = p.z;
  zs = [fakeZombie(p.x + 0.6, p.y, p.z), fakeZombie(p.x - 0.4, p.y, p.z + 0.5, 60), fakeZombie(p.x + ACID.poolR + 0.6, p.y, p.z), fakeZombie(p.x + ACID.poolR + 0.05, p.y, p.z, 500)];
  Object.assign(player, {x: p.x - 0.5, y: p.y, z: p.z});
  const t0 = draws;
  step(Math.round(2.2 / DT));
  const perTicks = draws - t0;
  const reacts = p.look.counts.reacts, eating = p.eating.length;
  log.push(['after2.2', zs.map(z => [z.brain.hp, z.brain.hits.length]), player.hp]);
  expect(toss(dirOf(0.5, -0.3, 1)).ok).toBe(true);
  log.push(['frames2', until(2)]);
  log.push(['pool2', sys.pools[1]?.x, sys.pools[1]?.y, sys.pools[1]?.z]);
  step(Math.round(GRENADE.cooldown / DT) + 1);
  Object.assign(player, {x: p.x + 9, z: p.z + 9});
  expect(toss(dirOf(-0.5, -0.3, 1)).ok).toBe(true);
  log.push(['frames3', until(3)]);
  log.push(['pool3', sys.pools[2]?.x, sys.pools[2]?.y, sys.pools[2]?.z]);
  step(Math.round(12 / DT));
  log.push(['end', sys.pools.length, zs.map(z => [z.brain.alive, z.brain.hp, z.brain.hits]), player.hp, kills, hurt, pain, melted, {...sys.counts}]);
  log.push(['stream', perThrow, perPool, perTicks, draws, base()]);
  return {log, perThrow, perPool, perTicks, reacts, eating, kills: kills.length / 3, exposures: sys.counts.exposures};
}

describe('visual only: the look changes nothing a pool does', () => {
  it('the same scenario with the look switched off: every burn, kill, exposure, counter and random draw is identical', () => {
    const on = scenario();
    // the scenario really exercises the hook: bodies in the pool, a kill in it, a prop being eaten
    expect(on.reacts).toBeGreaterThan(200);
    expect(on.eating).toBe(1);
    expect(on.kills).toBeGreaterThanOrEqual(1);
    expect(on.exposures).toBeGreaterThan(10);
    const calls = {react: 0, update: 0, place: 0, release: 0};
    vi.spyOn(AcidPoolVisual.prototype, 'react').mockImplementation(() => { calls.react++; });
    vi.spyOn(AcidPoolVisual.prototype, 'update').mockImplementation(() => { calls.update++; });
    vi.spyOn(AcidPoolVisual.prototype, 'place').mockImplementation(() => { calls.place++; });
    vi.spyOn(AcidPoolVisual.prototype, 'release').mockImplementation(() => { calls.release++; });
    const off = scenario();
    expect(calls.react).toBeGreaterThan(200);
    expect([calls.place, calls.release]).toEqual([3, 3]);
    expect(off.reacts).toBe(0); // (the look never ran)
    expect(JSON.stringify(off.log)).toBe(JSON.stringify(on.log));
  }, 120_000);

  it('the system\'s random stream is drawn exactly as before the look: 2 per throw, 4 x ACID.bubbles per pool, none while a pool lives', () => {
    const s = scenario();
    expect([s.perThrow, s.perPool, s.perTicks]).toEqual([2, 4 * ACID.bubbles, 0]);
    // and a pool on its own draws nothing but its seeds, whatever its look does
    let draws = 0;
    const r = mulberry32(5), sys = acidPoolRig(new THREE.Group(), () => { draws++; return r(); });
    const p = sys.addPool(0, 0, 0);
    expect(draws).toBe(4 * ACID.bubbles);
    expect(p.seeds.length).toBe(4 * ACID.bubbles);
    for (let f = 0; f < 60 * 11; f++) { if (sys.pools.length) p.look.react(0.3, 0.3, 1); sys.tick(DT); }
    expect([draws, sys.pools.length]).toEqual([4 * ACID.bubbles, 0]);
  }, 120_000);

  it('the unchanged rules of the pool: the same circle, 10 seconds, the same fade', () => {
    expect([ACID.poolR, ACID.poolSeconds, ACID.fadeIn, ACID.fadeOut, ACID.maxPools, ACID.bubbles, ACID.color]).toEqual([1.5, 10, 0.3, 1.6, 3, 10, 0xa8d02a]);
    const p = {x: 0, y: 0, z: 0, r: 1.5, age: 5, left: 5};
    expect([poolReach(p), poolStrength(p)]).toEqual([1.5, 1]);
    // the hazard is the CIRCLE, whatever the outline of the liquid: in at 0.999 r in every direction, out at 1.001 r
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * TAU;
      expect([inPool(p, Math.cos(a) * 1.4985, 0, Math.sin(a) * 1.4985), inPool(p, Math.cos(a) * 1.5015, 0, Math.sin(a) * 1.5015)]).toEqual([true, false]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('rendering rules', () => {
  it('every mesh a pool can draw is a warm prototype, planned by the warm-up while hidden; transparent FrontSide, no depth write, single pass', () => {
    const {sys, group} = rigOf(2);
    const scene = new THREE.Scene();
    scene.add(group);
    const protos = sys.warmPrototypes();
    expect(sys.warmPrototypes().every((o, i) => o === protos[i])).toBe(true); // (the same objects every time)
    const slots = slotMeshes(sys);
    expect(slots.map(m => m.name)).toEqual(Array.from({length: ACID.maxPools}, () => ['acid-pool', 'acid-pool-bubbles']).flat());
    // hidden MESHES directly under the system's (visible) group: no invisible group in between to block the compile
    for (const m of slots) { expect([m.visible, m.parent === group.children[0], group.children[0].visible]).toEqual([false, true, true]); }
    const plan = planWarmup(scene, {mode: 'full', cameraMask: 1, pools: protos});
    const planned = new Set(plan.items.map(i => i.object as THREE.Object3D));
    for (const m of slots) expect(planned.has(m), m.name).toBe(true); // (each film has its own material, each bead set is its own instanced draw)
    for (const it of plan.items) if (slots.includes(it.object as THREE.Mesh)) expect([it.flips.length, it.flips[0] === it.object, it.caster]).toEqual([1, true, false]);
    // a pool draws exactly two of those meshes, whichever slots are free
    const pools = [sys.addPool(0, 0, 0), sys.addPool(3, 0, 0), sys.addPool(6, 0, 0)];
    for (const p of pools) { expect(slots).toContain(p.mesh); expect(slots).toContain(p.bubbles); }
    expect(group.children[0].children.filter(o => o.visible && /^acid-pool/.test(o.name)).length).toBe(6);
    const films = new Set<THREE.Material>(), beads = new Set<THREE.Material>();
    for (const m of slots) {
      const mat = m.material as THREE.Material & {isNodeMaterial?: boolean; isMeshStandardNodeMaterial?: boolean};
      expect(mat.isMeshStandardNodeMaterial).toBe(true);
      expect([mat.transparent, mat.side, mat.depthWrite, mat.depthTest, mat.forceSinglePass, drawsTwoPass(m)]).toEqual([true, THREE.FrontSide, false, true, false, false]);
      expect([m.castShadow, m.receiveShadow, m.renderOrder]).toEqual([false, false, 2]);
      ((m as THREE.InstancedMesh).isInstancedMesh ? beads : films).add(mat);
    }
    expect([films.size, beads.size]).toEqual([ACID.maxPools, 1]);
    // the film draws before its beads: the same render order and sort depth, so three falls back to creation order
    for (const p of pools) { expect(p.mesh.id).toBeLessThan(p.bubbles.id); expect(p.mesh.position.toArray()).toEqual(p.bubbles.position.toArray()); }
    // never a ray hit (a shot or an interaction ray passes through the film and its beads)
    group.updateMatrixWorld(true);
    expect(new THREE.Raycaster(new THREE.Vector3(0.2, 2, 0.1), new THREE.Vector3(0, -1, 0)).intersectObjects(slots, true).length).toBe(0);
    // bounded: one fan and one small instanced set per pool
    expect(pools[0].mesh.geometry.index!.count / 3).toBe(POOL_EDGE.segments * 3);
    expect(pools[0].bubbles.count).toBe(BEADS);
    expect(BEADS).toBeLessThanOrEqual(96);
    // no light, no sprite, no line, nothing but meshes; and a fourth pool (never in the game: the acid cap) still works
    group.traverse(o => { expect((o as THREE.Light).isLight).not.toBe(true); });
    const extra = sys.addPool(9, 0, 0);
    expect(slots).not.toContain(extra.mesh);
    expect(sys.warmPrototypes()).toContain(extra.mesh);
  });

  it('the node materials build cleanly for WebGPU (WGSL) and the WebGL2 fallback (GLSL), lit, with few uniform buffers and one noise texture', () => {
    const looks = new AcidPoolVisuals(new THREE.Group(), 1, ACID.color);
    const v = looks.slots[0];
    v.place(0, 0, 0, 1.5, 7);
    v.update(0, 0, 0.6, 0, 0);
    const ubos = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/var<uniform>/g) ?? []).length : (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length;
    for (const [name, o] of [['film', v.mesh], ['beads', v.bubbles]] as const) {
      for (const b of buildBoth(o, {lights: [new THREE.PointLight(), new THREE.SpotLight(), new THREE.HemisphereLight()]})) {
        const tag = `${name} ${b.backend}`;
        expect(b.errors, tag).toEqual([]);
        expect(b.vertex.length, tag).toBeGreaterThan(300);
        expect(b.fragment.length, tag).toBeGreaterThan(1000);
        // (WebGPU allows 12 uniform buffers per stage: these use a handful — plain uniforms, no uniformArray)
        expect(ubos(b.vertex, b.backend), tag).toBeLessThanOrEqual(4);
        expect(ubos(b.fragment, b.backend), tag).toBeLessThanOrEqual(4);
        if (name === 'film') {
          // the four samples of the one noise tile, through one binding
          const samples = b.backend === 'wgsl' ? (b.fragment.match(/textureSample\w*\(/g) ?? []).length : (b.fragment.match(/\btexture\w*\(/g) ?? []).length;
          expect(samples, tag).toBeGreaterThanOrEqual(4);
          if (b.backend === 'wgsl') expect((b.fragment.match(/: texture_2d<f32>/g) ?? []).length, tag).toBeLessThanOrEqual(3);
          expect(b.vertex, tag).toMatch(/aRim/);
        } else {
          expect(b.vertex, tag).toMatch(/aBead/);
        }
      }
    }
    const tile = (looks as unknown as {tile: THREE.DataTexture}).tile;
    expect([tile.image.width, tile.image.height, tile.wrapS, tile.wrapT, tile.isDataTexture]).toEqual([LOOK_TILE, LOOK_TILE, THREE.RepeatWrapping, THREE.RepeatWrapping, true]);
    looks.dispose();
  });

  it('a liquid, never a gas: no name like fog / gas / smoke / haze / vapour on any object, material or texture, and no volume or fog code imported', () => {
    const {sys, group} = rigOf(1);
    sys.warmPrototypes();
    sys.addPool(0, 0, 0);
    const names: string[] = [], own: string[] = [];
    group.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined, g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const all = [o.name, m?.name ?? '', g?.name ?? ''];
      names.push(...all);
      if (/^acid-pool/.test(o.name)) own.push(...all);
    });
    own.push((sys as unknown as {looks: {tile: THREE.Texture}}).looks.tile.name);
    expect(own.filter(n => /^acid-pool/.test(n)).length).toBeGreaterThanOrEqual(ACID.maxPools * 4 + 1);
    // everything the pool's look adds, and anything under the system named for acid
    for (const n of [...own, ...names.filter(x => /acid/i.test(x))]) expect(n).not.toMatch(/fog|gas|smoke|haze|vapou?r|mist|cloud/i);
    for (const file of ['acidPoolShape', 'acidPoolLook', 'acidPoolVisual']) {
      const src = readFileSync(new URL(`../src/weapons/${file}.ts`, import.meta.url), 'utf8');
      const imports = (src.match(/^import [\s\S]*?from '[^']+';/gm) ?? []).join('\n');
      expect(imports.length, file).toBeGreaterThan(20);
      expect(imports, file).not.toMatch(/fog|volumetric|smoke|atmosphere|uniformArray|Light\b|canvas/i);
      expect(src, file).not.toMatch(/uniformArray\(|document\.|createElement|getContext|new THREE\.\w*Light\(|DoubleSide/);
    }
  });

  it('A/B on three\'s real WebGPURenderer (no-op device): after the warm-up, pools bursting, reacting, drying and reusing their slots build 0 node variants and request 0 pipelines', async () => {
    const run = async (registered: boolean) => {
      const scene = new THREE.Scene();
      const k = await rig(scene);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({color: 0x333333}));
      floor.rotation.x = -Math.PI / 2;
      floor.castShadow = floor.receiveShadow = true;
      scene.add(floor);
      const sys = acidPoolRig(scene, mulberry32(17));
      const protos = sys.warmPrototypes();
      if (registered) k.reg.addPool('grenades', () => sys.warmPrototypes()); // (as Game registers it)
      k.cam.position.set(0, 1.62, 3.4);
      k.cam.rotation.x = -0.42;
      k.cam.updateMatrixWorld(true);
      await k.warm();
      k.frame();
      let shown = 0;
      const c = k.count(() => {
        for (let round = 0; round < 2; round++) {
          const pools = [sys.addPool(0, 0, 0), sys.addPool(-2.2, 0, -1), sys.addPool(2.2, 0, -1)];
          for (let f = 0; sys.pools.length && f < 400; f++) {
            if (f % 3 === 0 && pools[0].look.inUse) pools[0].look.react(0.5, -0.2, 1);
            sys.tick(1 / 20);
            k.frame();
            if (f === 20) shown += protos.filter(o => o.visible && /^acid-pool/.test(o.name)).length;
          }
        }
      });
      return {...c, shown, pools: sys.counts.pools, dried: sys.counts.poolsDried};
    };
    const warmed = await run(true);
    expect([warmed.shown, warmed.pools, warmed.dried]).toEqual([12, 6, 6]);
    expect({builds: warmed.builds, pipelines: warmed.pipelines}).toEqual({builds: 0, pipelines: 0});
    // the control: the same pools without the prototypes registered do build on first use (so the count above means something)
    const control = await run(false);
    expect(control.shown).toBe(12);
    expect(control.builds).toBeGreaterThanOrEqual(ACID.maxPools * 2);
    expect(control.pipelines).toBeGreaterThan(0);
  }, 300_000);
});

/** A real renderer on the no-op device drawing `scene` through a pass in a RenderPipeline (the game's depth-1 station draw). */
async function rig(scene: THREE.Scene) {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  installShadowAlphaTwin(r);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const n = {builds: 0, pipelines: 0};
  const R = r as unknown as {_nodes: {nodeFrame: {update(): void}}; backend: {createNodeBuilder: (...a: unknown[]) => unknown; createRenderPipeline: (...a: unknown[]) => unknown}};
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { n.builds++; return cnb(...a); };
  const crp = R.backend.createRenderPipeline.bind(R.backend);
  R.backend.createRenderPipeline = (...a: unknown[]) => { n.pipelines++; return crp(...a); };
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  cam.rotation.order = 'YXZ';
  const torch = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
  torch.position.set(0.2, -0.15, 0.1); torch.target.position.set(0.04, -0.12, -6); torch.castShadow = true; torch.shadow.mapSize.set(512, 512);
  cam.add(torch, torch.target);
  scene.add(cam, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.4));
  const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
  const pipe = new W.RenderPipeline(r, scenePass as never);
  const frame = () => { r.info.reset(); R._nodes.nodeFrame.update(); r.setRenderTarget(null); pipe.render(); };
  const reg = new WarmupRegistry();
  const warm = async () => {
    const res = await runWarmup({
      renderer: r as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => scenePass.renderTarget, torch, torchIntensity: 1, frame, finish: frame, hide: () => {}, alive: () => true,
      sceneDepth: () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(r, scenePass.renderTarget, frame) ?? 0; } finally { cam.layers.mask = m; } },
    }, {yieldFrame: () => Promise.resolve()});
    expect(res.status).toBe('complete');
    return res;
  };
  /** What `fn` made three build / request. */
  const count = (fn: () => void) => { const b = n.builds, p = n.pipelines; fn(); return {builds: n.builds - b, pipelines: n.pipelines - p}; };
  return {r, n, cam, torch, frame, reg, warm, count};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// QA: CPU previews (opt-in; nothing is written in a normal run)

describe('QA previews', () => {
  it.skipIf(!process.env.ACID_POOL_PREVIEW)('ACID_POOL_PREVIEW=<dir>: a life of a pool top-down (timeline.png) and first-person views (views.png)', async () => {
    const out = process.env.ACID_POOL_PREVIEW!;
    mkdirSync(out, {recursive: true});
    const sharp = (await import('sharp')).default;
    const sheet = async (file: string, tiles: Buffer[], w: number, h: number, cols: number) => {
      const comps = await Promise.all(tiles.map(async (b, i) => ({input: await sharp(b, {raw: {width: w, height: h, channels: 3}}).png().toBuffer(), left: (i % cols) * w, top: Math.floor(i / cols) * h})));
      await sharp({create: {width: cols * w, height: Math.ceil(tiles.length / cols) * h, channels: 3, background: {r: 0, g: 0, b: 0}}}).composite(comps).png().toFile(`${out}/${file}`);
    };
    const preview = (p: AcidPool): PreviewPool => ({look: p.look.look, reach: poolReach(p), beads: p.look.beads(), body: ACID.color});
    /** A pool aged to `t` s with a body standing in it from 1.6 s to 4.5 s and another walking through from 5.5 s to 7 s. */
    const aged = (t: number) => {
      const {sys} = rigOf(11);
      const p = sys.addPool(0, 0, 0);
      for (let s = 0; s < t - 1e-9; s += DT) {
        if (s > 1.6 && s < 4.5) p.look.react(0.7, -0.35, 1);
        if (s > 5.5 && s < 7) p.look.react(-1.2 + (s - 5.5) * 1.2, 0.6, 1);
        sys.tick(DT);
      }
      return p;
    };
    const times = [0.05, 0.2, 0.6, 1.4, 3, 4.2, 6.5, 8.4, 8.9, 9.2, 9.5, 9.8];
    await sheet('timeline.png', times.map((t, i) => renderTop(preview(aged(t)), 420, {light: i === 4 ? 0.06 : 0.9})), 420, 420, 4);
    const views: {t: number; eye: [number, number, number]; at: [number, number, number]; torch: number; ambient: number}[] = [
      {t: 3.2, eye: [0, 1.62, 3.6], at: [0, 0, 0.3], torch: 1, ambient: 0.35},
      {t: 3.2, eye: [0, 1.62, 3.6], at: [0, 0, 0.3], torch: 1, ambient: 0.02},
      {t: 3.2, eye: [0, 1.62, 3.6], at: [0, 0, 0.3], torch: 0, ambient: 0.02},
      {t: 3.2, eye: [1.5, 1.0, 0.9], at: [0.7, 0, -0.35], torch: 1, ambient: 0.2},
      {t: 0.15, eye: [0, 1.62, 3.6], at: [0, 0, 0.3], torch: 1, ambient: 0.2},
      {t: 9.2, eye: [0, 1.62, 3.6], at: [0, 0, 0.3], torch: 1, ambient: 0.2},
    ];
    await sheet('views.png', views.map(v => renderView(preview(aged(v.t)), {w: 640, h: 360, ...v})), 640, 360, 2);
  }, 600_000);
});
