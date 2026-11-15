// Task studio-flamethrower-fire-20261114-031614-01 (user: "convincing fire/smoke ... Fire clings to actual surfaces/props ... produces
// convincing smoke; reuse existing volumetrics where appropriate"): HOW THE FIRE LOOKS. fire/fireSystem.ts holds what burns (the stream,
// the clinging patches, burning props, burning bodies); this draws it, every frame, from that state — nothing here decides damage.
//
// LAYERS (five draws, all pooled rings: nothing allocates in play):
//  - FLAMES: one instanced sprite ring (light added over what is behind, plus an optional share of occlusion per sprite: see STREAM).
//    Each sprite is a flame LICK, not a disc: a teardrop mask broken up by two octaves of scrolling noise and ERODED as it ages (the
//    alpha threshold climbs: it tears into wisps and goes out), coloured by its own heat — white-yellow where it is dense and young,
//    orange, then deep red at the thinning tips. The stream, the clinging patches (licks rising off the surface, tapering), burning
//    props (off their top and sides) and burning bodies all spawn into it; sparks are the same ring (tiny, hot, not eroded).
//  - STREAM (task studio-flamethrower-vfx-20261115-001305-01; the user: it read as an "orange gas thrower"): a burning JET, not a cloud
//    of growing orange balls. From the burner bell: a white-hot flare at the nozzle; a CORE of fast streaks (each stretched along its
//    own on-screen motion, so the jet reads as speed and converges on the aim point seen from behind); a rolling BODY of turbulent gouts
//    (domain-warped noise, ragged edges, cooling from yellow to deep red with age, hiding a share of what is behind them so the body has
//    substance instead of glowing like gas), buffeted by a coherent turbulence field so the jet snakes; flame TONGUES peeling off the
//    envelope and rising; and a HEAD where it stops — rolling billows in open air, a splash running out along the surface it hits —
//    with sooty smoke off the body's far half and the head. Its front travels at FLAME.speed (the rules' own delay), the head appears
//    only when the flame has arrived and burns on for the flight time after the trigger is released. Nothing reaches past the stream's
//    reach and cone; nothing here decides what burns.
//  - SMOKE: a second sprite ring (normal blending): dark billows that rise off every fire's top, grow, tumble and thin out — lit
//    warm from below where they leave the flames, grey-brown above. Never green (green fog is the toxic gas: CLAUDE.md), no hazard.
//  - GLOW: instanced additive pools on the burning surface (floor, wall, ceiling, under a burning prop): the fire reads as ON it.
//  - SOOT: instanced dark marks the fire leaves on the surface (a bounded ring, fading over SOOT_SECONDS; never saved).
//  - VOLUMETRIC SMOKE + LIGHT (the existing atmosphere, render/volumetric.ts): the strongest fires near the player raise real smoke
//    plumes in the fog march (at most PLUMES of its 4 emitters), and ONE pooled fire light (a FlareLight: occluded by walls through the
//    atmosphere's window, like a flare's) lights the room and the smoke from the strongest fire, flickering. The light is created at
//    boot and stays in the scene at intensity 0 (the light set never changes: no recompiles). With the fog pass off the sprite smoke
//    and the light still show.
// All textures here are runtime DATA (noise): a dynamic effect (the texture rule's exemption), no authored art.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, PointsNodeMaterial} from 'three/webgpu';
import {Discard, Fn, If, attribute, cameraProjectionMatrix, cameraViewMatrix, cos, dot, exp, float, instancedDynamicBufferAttribute, length, mix, positionView, select, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4} from 'three/tsl';
import {FlareLight} from '../world/flareLight';
import {FLAME} from './flamethrowerSpec';
import {patchRadius, patchStrength, streamRadius, type FireEnemy, type FirePatch, type FireSystem, type FireView} from './fireSystem';

// biome-ignore lint: loosely typed TSL nodes
type TNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FIRE_FX = {
  flames: 768,
  smoke: 256,
  glows: 32,
  soot: 48,
  /** Seconds a soot mark stays (its last quarter fades). */
  sootSeconds: 80,
  /** Volumetric smoke plumes at once (of the atmosphere's 4 emitters: flares / lures keep the rest). */
  plumes: 2,
  /** Burning bodies drawn with flames at once. */
  bodies: 10,
  /** The fire light: warm orange, candela at a full fire, cutoff (m). */
  light: {color: 0xff7426, intensity: 15, distance: 13, decay: 2},
  /** The volumetric plume of a full fire (render/smoke.ts SmokeEmitterOptions): grey-brown, never green. */
  plume: {color: 0x5c554d, rate: 1.1, radius: 1.3, life: 5.5, density: 0.8},
  /**
   * The stream's look: sprites a second while it runs, by layer (the head's and the splash's once the flame has arrived). A core
   * streak is stretched along its on-screen motion over `shutter` s, to at most `stretch` x its width; a gout of the body over
   * `rollShutter`, to at most `rollStretch` (they flow into one column instead of a row of puffs).
   */
  stream: {nozzle: 34, core: 130, body: 150, licks: 46, head: 24, splash: 60, smoke: 7, headSmoke: 8, shutter: 0.032, stretch: 5, rollShutter: 0.022, rollStretch: 2.4},
  /**
   * The game's pooled muzzle light while the flamethrower is in the hands (game.ts): fire-coloured, half way along the stream (at
   * least `minAt`, at most `maxAt` m ahead of the eye), and dimmed when the surface the stream hits is closer to it than `near` m
   * (as the square of that gap, never below `min`): a metre off a wall its inverse square bleached the wall behind the flames — the
   * fire light on the patch there lights that wall.
   */
  streamLight: {color: 0xff9a4c, minAt: 0.8, maxAt: 2.4, near: 2.4, min: 0.3},
} as const;

/**
 * The stream's light flicker (0.77..1.23, mean 1: the light's old random flicker's mean): a few incommensurate waves — a burning jet's
 * light breathes, it does not strobe from frame to frame.
 */
export function streamFlicker(t: number): number {
  return 1 + 0.1 * Math.sin(t * 13.1) + 0.07 * Math.sin(t * 29.3 + 1.7) + 0.06 * Math.sin(t * 5.3 + 0.4);
}

/** Where the stream's light sits along the aim (m ahead of the eye) for a stream reaching `reach` m. */
export function streamLightAt(reach: number): number {
  const L = FIRE_FX.streamLight;
  return Math.min(L.maxAt, Math.max(L.minAt, reach * 0.5));
}

/** The stream light's level (x the muzzle light's intensity) at time `t` for a stream reaching `reach` m: see FIRE_FX.streamLight. */
export function streamLightLevel(reach: number, t: number): number {
  const L = FIRE_FX.streamLight, gap = Math.max(0, reach - streamLightAt(reach)) / L.near;
  return Math.max(L.min, Math.min(1, gap * gap)) * streamFlicker(t);
}

/** The atmosphere's smoke / scatter API (render/volumetric.ts), every member optional. */
export interface FireSmokeHost {
  addSmokeEmitter?(o: {x: number; y: number; z: number; color: number; rate: number; radius: number; life: number; density?: number}): FirePlume | null | undefined | void;
  addScatterLight?(light: THREE.PointLight): unknown;
  removeScatterLight?(light: THREE.PointLight): unknown;
}
interface FirePlume { setPos?(x: number, y: number, z: number): void; stop?(fade?: number): void }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** The offset `r` m out from a jet's axis at angle `a` about it (u, w: unit vectors across it) into `out`. */
function across(u: THREE.Vector3, w: THREE.Vector3, a: number, r: number, out: {x: number; y: number; z: number}): void {
  const c = Math.cos(a) * r, sn = Math.sin(a) * r;
  out.x = u.x * c + w.x * sn; out.y = u.y * c + w.y * sn; out.z = u.z * c + w.z * sn;
}

/** Tileable value-noise fbm in R / G (two fields) and a finer one in B: the flames' and smoke's break-up (deterministic data). */
export function fireNoiseTexture(n = 128): THREE.DataTexture {
  let a = 0x5f3759df;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const field = (cells: number): Float32Array => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x / n * cells, fy = y / n * cells, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[(j % cells) * cells + (i % cells)];
      out[y * n + x] = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    }
    return out;
  };
  const fbm = (cells: readonly number[]): Float32Array => {
    const out = new Float32Array(n * n);
    let w = 1, sum = 0;
    for (const c of cells) { const f = field(c); for (let i = 0; i < out.length; i++) out[i] += f[i] * w; sum += w; w *= 0.5; }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { out[i] /= sum; lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo); // (full 0..1 range: the erosion thresholds are absolute)
    return out;
  };
  const R = fbm([4, 8, 16, 32]), G = fbm([5, 10, 20, 40]), B = fbm([16, 32, 64]);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { data[i * 4] = Math.round(R[i] * 255); data[i * 4 + 1] = Math.round(G[i] * 255); data[i * 4 + 2] = Math.round(B[i] * 255); data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.name = 'fire-noise';
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

interface FogUniforms { mode: TNode; density: TNode; near: TNode; far: TNode; color: TNode }

/** Flame sprite shapes (the whole part of aB.z; its fraction is the sprite's occlusion share). */
const TONGUE = 0, BALL = 1, SPARK = 2, ROLL = 3, STREAK = 4;
export const FLAME_SHAPES = Object.freeze({tongue: TONGUE, ball: BALL, spark: SPARK, roll: ROLL, streak: STREAK});
/** Per-sprite motion parameters (FireSprites.par). */
const PAR = 9;

/**
 * The on-screen motion of a sprite from its view-space centre `pv` and world velocity `vel`: `dir` ~ its projected velocity x depth^2
 * (screen axes: x right, y up — the sprite's uv axes), `speed` = |dir|, `depth` (m), `side` 0..1 (1: it crosses the view; 0: it moves
 * along the line of sight). Built once per shader stage (the size in the vertex stage, the shape in the fragment stage).
 */
function screenMotion(vel: TNode) {
  const pv = positionView as TNode;
  const depth = pv.z.negate().max(0.05);
  const vd = (cameraViewMatrix as TNode).mul(vec4(vel, 0)).xyz;
  const dir = vd.xy.mul(depth).add(pv.xy.mul(vd.z));
  const speed = length(dir);
  const vl = length(vd);
  const side = select(vl.greaterThan(1.0), speed.div(vl.mul(depth)).clamp(0, 1), float(1));
  return {dir, speed, depth, side};
}

/**
 * How long a sprite of `shape` (aB.z) and width `size` is drawn along its on-screen motion (x its width): a STREAK over the shutter, a
 * ROLL over the shorter roll shutter (capped lower), anything else 1.
 */
function spriteStretch(mv: ReturnType<typeof screenMotion>, size: TNode, shape: TNode): TNode {
  const S = FIRE_FX.stream, streak = shape.greaterThan(STREAK - 0.5);
  const k = mv.speed.mul(select(streak, float(S.shutter), float(S.rollShutter))).div(mv.depth.mul(size.max(0.005)));
  return select(shape.greaterThan(ROLL - 0.5), float(1).add(k).min(select(streak, float(S.stretch), float(S.rollStretch))), float(1));
}

/**
 * One ring of instanced sprites (world/fx.ts Particles' draw: a THREE.Sprite with `count = cap` + PointsNodeMaterial, per-instance
 * dynamic attributes), with what fire needs on top: age (erosion, the heat ramp), rotation, a noise seed, a shape.
 *   aA = (size m, age 0..1, rotation rad, seed)      aB = flames: (heat, erode 0..1, shape + occlusion, alpha); smoke: (r, g, b, alpha)
 *   aV = flames: the world velocity (m/s: a streak's stretch, the stream's end-on view)
 * FLAMES are drawn IN the sprite, not by it: a TONGUE is a whole standing flame (its foot at the sprite's lower edge, tapering to a
 * swaying tip, torn into licks by noise that streams up through it with the clock — it flickers while it stands), a BALL is a rolling
 * gout of fire (splashes, bursts, wisps), a SPARK a hot dot; the stream's own: a ROLL is a turbulent gout of the jet's body (domain-
 * warped noise, a ragged edge, cooling as it ages) and a STREAK a fast hot blob of its core, stretched along its on-screen motion.
 * Colour follows the flame's own density: white-yellow in the thick foot, orange, deep red at the thinning tips; as a sprite ages its
 * threshold climbs and it tears apart. A flame ADDS its light; a sprite with an occlusion share (the stream's body) also hides that
 * share of what is behind it (the colour blend is ONE, ONE_MINUS_SRC_ALPHA over a premultiplied light; the target's alpha is kept). With
 * no occlusion that is exactly the additive blend.
 */
class FireSprites {
  readonly points: THREE.Sprite;
  private readonly pos: Float32Array; private readonly vel: Float32Array;
  private readonly a: Float32Array; private readonly b: Float32Array;
  private readonly life: Float32Array; private readonly max: Float32Array;
  /**
   * Per particle: size growth (m/s; with a growth power: the whole life's gain, m), upward acceleration m/s2, drag 1/s, spin rad/s, peak
   * alpha, fade-in share of its life, turbulence m/s2, growth power (0: linear), its first size (m).
   */
  private readonly par: Float32Array;
  /** Per slot: how many sprites it has held (a kept slot index + its stamp says whether it is still the same sprite). */
  private readonly stamps: Uint32Array;
  private readonly attrs: {pos: THREE.InstancedBufferAttribute; a: THREE.InstancedBufferAttribute; b: THREE.InstancedBufferAttribute; vel: THREE.InstancedBufferAttribute | null};
  private next = 0;
  live = 0;

  constructor(readonly cap: number, readonly kind: 'flame' | 'smoke', noise: THREE.Texture, time: TNode) {
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3);
    this.a = new Float32Array(cap * 4); this.b = new Float32Array(cap * 4);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.par = new Float32Array(cap * PAR); this.stamps = new Uint32Array(cap);
    const attr = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    const flame = kind === 'flame';
    this.attrs = {pos: attr(this.pos, 3), a: attr(this.a, 4), b: attr(this.b, 4), vel: flame ? attr(this.vel, 3) : null};
    const fogU: FogUniforms = {mode: uniform(0), density: uniform(0), near: uniform(1), far: uniform(1000), color: uniform(new THREE.Color())};
    const mat = new PointsNodeMaterial(flame
      ? {transparent: true, depthWrite: false, sizeAttenuation: true,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor}
      : {transparent: true, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true});
    mat.name = flame ? 'fire-flames' : 'fire-smoke';
    const aPos = instancedDynamicBufferAttribute(this.attrs.pos as never) as TNode;
    const aA = instancedDynamicBufferAttribute(this.attrs.a as never) as TNode;
    const aB = instancedDynamicBufferAttribute(this.attrs.b as never) as TNode;
    const aV = flame ? instancedDynamicBufferAttribute(this.attrs.vel as never) as TNode : null;
    mat.positionNode = aPos;
    const depth = (positionView as TNode).z.negate();
    const size = aA.x.mul((cameraProjectionMatrix as TNode).element(1).y).mul(depth.div(depth.max(0.05)));
    if (aV) {
      // a stretched sprite (the stream's streaks and gouts) is its length: its width times the stretch its on-screen motion gives it
      mat.sizeNode = select(aB.w.greaterThan(0), size.mul(spriteStretch(screenMotion(aV), aA.x, aB.z)), float(0));
    } else mat.sizeNode = select(aB.w.greaterThan(0), size, float(0));
    mat.fog = false; // (applied below: flames' light fades to black, smoke mixes toward the fog colour)
    mat.colorNode = Fn(() => {
      const p0 = (uv() as TNode).sub(0.5).toVar();
      const c = cos(aA.z), s = sin(aA.z);
      const p = vec2(p0.x.mul(c).sub(p0.y.mul(s)), p0.x.mul(s).add(p0.y.mul(c))).toVar() as TNode;
      const age = aA.y.toVar() as TNode;
      const seed = vec2(aA.w, aA.w.mul(1.618)).toVar() as TNode;
      const d = (positionView as TNode).z.negate();
      const ff = select(fogU.mode.greaterThan(1.5), smoothstep(fogU.near, fogU.far, d), select(fogU.mode.greaterThan(0.5), exp(fogU.density.mul(fogU.density).mul(d).mul(d).negate()).oneMinus(), float(0))).toVar() as TNode;
      const r = length(p).mul(2).toVar() as TNode;
      if (flame && aV) {
        const shape = aB.z.floor().toVar() as TNode;
        const occ = aB.z.fract() as TNode;
        // a stretched sprite's own frame: along its on-screen motion (-1 tail .. +1 head over the sprite) and across it (-1..1 over its
        // width: the sprite is `stretch` widths long), and the ellipse radius in that frame
        const mv = screenMotion(aV);
        const stretch = spriteStretch(mv, aA.x, aB.z).toVar() as TNode;
        const n = select(mv.speed.greaterThan(1e-5), mv.dir.div(mv.speed.max(1e-5)), vec2(0, 1)).toVar() as TNode;
        const along = dot(p0, n).mul(2).toVar() as TNode;
        const across = p0.y.mul(n.x).sub(p0.x.mul(n.y)).mul(2).mul(stretch).toVar() as TNode;
        const re = length(vec2(along, across)).toVar() as TNode;
        const side = mv.side.toVar() as TNode;
        // density (f), the erosion edge's softness for what it hides (edge) and for its light (glow: a flame's thin rim glows dimly
        // rather than outlining it), how much the heat cools with age, the light's gain, the end-on factor
        const f = float(0).toVar(), edge = float(0.2).toVar(), glow = float(0.2).toVar(), cool = float(0).toVar(), gain = float(1).toVar(), view = float(1).toVar();
        If(shape.lessThan(BALL - 0.5), () => {
          // TONGUE: y 0 at the foot .. 1 at the tip; the tip sways (a slow noise, stronger with height), the body narrows upward
          const y = p.y.add(0.5).clamp(0, 1);
          const sway = (texture(noise, vec2(p.x.mul(0.6).add(seed.x), y.mul(0.5).sub(time.mul(0.85)).add(seed.y))) as TNode).b.sub(0.5);
          const xw = p.x.add(sway.mul(0.42).mul(y));
          // (widest a little above the foot, drawn in to the tip: a flame's belly, not a cone)
          const w = float(1).sub(y).pow(0.75).mul(smoothstep(-0.12, 0.26, y).mul(0.5).add(0.5)).mul(0.44).add(0.015);
          const body = float(1).sub(xw.abs().div(w)).clamp(0, 1).pow(0.8);
          // the licks: two octaves streaming up through the flame
          const n1 = (texture(noise, vec2(xw.mul(1.15).add(seed.x), y.mul(0.8).sub(time.mul(1.45)).add(seed.y))) as TNode).r;
          const n2 = (texture(noise, vec2(xw.mul(2.7).add(seed.y.mul(2.3)), y.mul(1.9).sub(time.mul(2.5)).add(seed.x))) as TNode).g;
          const lick = n1.mul(0.95).add(0.3).mul(n2.mul(0.7).add(0.62));
          // (a tongue thins toward its tip — more where the noise is thin —, and is soft at its very foot: it sits in the glow)
          f.assign(body.mul(lick).sub(y.mul(float(0.62).sub(n1.mul(0.42)))).sub(float(1).sub(body).mul(n2).mul(0.16)).mul(smoothstep(0.0, 0.15, y)).mul(1.25));
        }).ElseIf(shape.lessThan(SPARK - 0.5), () => {
          // BALL: a gout rolling in place
          const n1 = (texture(noise, vec2(p.x.mul(1.15).add(seed.x), p.y.mul(0.8).sub(age.mul(0.9)).add(seed.y))) as TNode).r;
          const n2 = (texture(noise, vec2(p.x.mul(2.7).add(seed.y.mul(2.3)), p.y.mul(1.9).sub(age.mul(1.6)).add(seed.x))) as TNode).g;
          const lick = n1.mul(0.95).add(0.3).mul(n2.mul(0.7).add(0.62));
          f.assign(float(1).sub(r).clamp(0, 1).pow(0.8).mul(lick).mul(1.15));
        }).ElseIf(shape.lessThan(ROLL - 0.5), () => {
          // SPARK
          f.assign(float(1).sub(r).clamp(0, 1).pow(2).mul(2.2));
        }).ElseIf(shape.lessThan(STREAK - 0.5), () => {
          // ROLL: the jet's body, in its own motion frame (drawn longer along its motion: the gouts flow into one column) — the noise
          // is warped by a slower noise that drifts with age (it rolls and folds) and runs back along it, the silhouette is torn by the
          // same turbulence; dense hot folds, thin gaps; seen end-on (the shooter's own view down the jet) each gout is fainter, since
          // there every gout stacks on the next
          const g = vec2(across, along).mul(0.5);
          const wv = (texture(noise, g.mul(0.45).add(seed).add(vec2(age.mul(0.25), age.mul(0.5)))) as TNode).rg.sub(0.5);
          const q = g.add(wv.mul(0.8));
          const b1 = (texture(noise, q.mul(1.1).add(seed.yx).add(vec2(0, age.mul(0.75)))) as TNode).r;
          const b2 = (texture(noise, q.mul(2.6).add(seed.mul(2.3)).add(vec2(time.mul(0.35), age.mul(1.5)))) as TNode).g;
          const t = b1.mul(0.62).add(b2.mul(0.38));
          const rr = re.add(t.sub(0.5).mul(0.75));
          f.assign(float(1).sub(smoothstep(0.15, 1.0, rr)).mul(t.sub(0.2).mul(2.0).clamp(0.14, 2)).mul(1.1));
          edge.assign(0.1);
          glow.assign(0.3);
          cool.assign(0.5);
          view.assign(side.mul(0.55).add(0.45));
        }).Else(() => {
          // STREAK: an ellipse along its on-screen motion, hottest toward its head, its tail fading, broken into beads and gaps by
          // noise running back along it (a core of burning fuel, not a beam)
          const sn = (texture(noise, vec2(along.mul(0.35).sub(time.mul(2.6)).add(seed.x), across.mul(0.12).add(seed.y))) as TNode).r;
          f.assign(float(1).sub(re).clamp(0, 1).pow(0.65).mul(smoothstep(-1.0, 0.15, along)).mul(smoothstep(0.22, 0.62, sn).mul(1.1).add(0.15)).mul(1.3));
          edge.assign(0.14);
          glow.assign(0.2);
          cool.assign(0.3);
          gain.assign(1.25);
          view.assign(side.mul(0.45).add(0.55));
        });
        // erosion: the threshold climbs with age (it tears into wisps and goes out)
        const thr = age.pow(1.6).mul(0.6).mul(aB.y);
        const v = f.sub(thr);
        const al = smoothstep(float(0), edge, v).mul(aB.w).mul(view);
        Discard(al.lessThan(0.003));
        const heat = v.mul(aB.x).mul(float(1).sub(cool.mul(age)));
        const red = vec3(0.5, 0.04, 0.0), orange = vec3(1.0, 0.31, 0.03), yellow = vec3(1.0, 0.66, 0.17), white = vec3(1.0, 0.9, 0.62);
        const col = mix(mix(mix(red, orange, smoothstep(0.0, 0.3, heat)), yellow, smoothstep(0.28, 0.66, heat)), white, smoothstep(0.7, 1.15, heat)) as TNode;
        const lit = smoothstep(float(0), glow, v).mul(aB.w).mul(view);
        const k = ff.oneMinus();
        // (premultiplied: the light it adds, and the share of what is behind that it hides)
        return vec4(col.mul(gain).mul(lit).mul(k), occ.mul(al).mul(k));
      }
      // smoke: a soft rolling billow — big folds (slow), finer detail, thinning from the rim inward as it ages. Lit by the fire it
      // leaves (its birth colour, aB.rgb) and going dark as it climbs away from it: smoke in a dark station is a dark veil, not a glow.
      const m0 = float(1).sub(r).clamp(0, 1);
      const soft = m0.mul(m0).mul(float(3).sub(m0.mul(2)));
      const n1 = (texture(noise, p.mul(0.3).add(seed).add(vec2(0, age.mul(-0.1)))) as TNode).r;
      const n2 = (texture(noise, p.mul(0.72).add(seed.mul(1.9)).add(vec2(time.mul(0.013), time.mul(-0.03)))) as TNode).g;
      const dens = soft.mul(n1.mul(1.0).add(0.22)).mul(n2.mul(0.55).add(0.7));
      const thr = age.mul(0.3);
      const al = smoothstep(thr, thr.add(0.42), dens).mul(aB.w);
      Discard(al.lessThan(0.003));
      const lit = float(1).sub(age).pow(1.7).mul(soft.mul(0.5).add(0.5));
      const cold = (vec3(0.05, 0.047, 0.045) as TNode).mul(n2.mul(0.8).add(0.55));
      const col = mix(cold as TNode, aB.rgb as TNode, lit as TNode) as TNode;
      return vec4(mix(col, fogU.color, ff), al);
    })();
    this.points = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial);
    this.points.name = flame ? 'fire-flames' : 'fire-smoke';
    this.points.count = cap;
    this.points.frustumCulled = false;
    this.points.renderOrder = flame ? 4 : 3; // (smoke under the flames' glow; both over the world's decals)
    this.points.visible = false;
    this.points.raycast = () => {};
    this.points.onBeforeRender = (_r, scene) => {
      const f = scene.fog as (THREE.Fog | THREE.FogExp2 | null);
      const u = fogU as unknown as Record<keyof FogUniforms, {value: number | THREE.Color}>;
      if (f && (f as THREE.FogExp2).isFogExp2) { u.mode.value = 1; u.density.value = (f as THREE.FogExp2).density; }
      else if (f && (f as THREE.Fog).isFog) { u.mode.value = 2; u.near.value = (f as THREE.Fog).near; u.far.value = (f as THREE.Fog).far; }
      else u.mode.value = 0;
      if (f) (u.color.value as THREE.Color).copy(f.color);
    };
  }

  /**
   * `b0..b2`: flames (heat, erode, shape + occlusion share); smoke (r, g, b). `grow` m/s, `lift` m/s2 upward, `drag` 1/s, `fadeIn`
   * share of its life, `rot` the sprite's turn (rad; null: any), `turb` the turbulence field's push (m/s2; 0: none), `growPow` > 0: the
   * size is first size + grow x age^growPow (a jet that stays narrow near the bell and blooms toward its end).
   */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, b0: number, b1: number, b2: number, alpha: number, grow: number, lift: number, drag: number, spin: number, fadeIn = 0.12, rot: number | null = null, turb = 0, growPow = 0): number {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.life[i] <= 0) this.live++;
    this.stamps[i]++;
    const j = i * 3, k = i * 4, q = i * PAR;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.a[k] = size; this.a[k + 1] = 0; this.a[k + 2] = rot ?? rnd(0, Math.PI * 2); this.a[k + 3] = Math.random() * 7;
    this.b[k] = b0; this.b[k + 1] = b1; this.b[k + 2] = b2; this.b[k + 3] = fadeIn > 0 ? 0.0001 : alpha;
    this.life[i] = this.max[i] = life;
    this.par[q] = grow; this.par[q + 1] = lift; this.par[q + 2] = drag; this.par[q + 3] = spin; this.par[q + 4] = alpha; this.par[q + 5] = fadeIn; this.par[q + 6] = turb; this.par[q + 7] = growPow; this.par[q + 8] = size;
    this.points.visible = true;
    return i;
  }

  stamp(i: number): number { return this.stamps[i]; }

  /** Slot i still holds the live sprite stamped `stamp`: its position, velocity, age, seconds left and size into `out` (else false). */
  read(i: number, stamp: number, out: {x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; left: number; size: number}): boolean {
    if (i < 0 || this.stamps[i] !== stamp || this.life[i] <= 0) return false;
    const j = i * 3, k = i * 4;
    out.x = this.pos[j]; out.y = this.pos[j + 1]; out.z = this.pos[j + 2];
    out.vx = this.vel[j]; out.vy = this.vel[j + 1]; out.vz = this.vel[j + 2];
    out.age = 1 - this.life[i] / this.max[i]; out.left = this.life[i]; out.size = this.a[k];
    return true;
  }

  /**
   * Age and move every live sprite. `clock` (s) drives the turbulence field: a smooth field of position and time (sprites near each
   * other are pushed alike, so a jet snakes and its gouts roll rather than jitter), with a little of each sprite's own seed in it.
   */
  update(dt: number, clock = 0): void {
    if (this.live <= 0) { if (this.points.visible) this.points.visible = false; return; }
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 4;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.b[k + 3] = 0; continue; }
      live++;
      const j = i * 3, q = i * PAR, dr = Math.max(0, 1 - this.par[q + 2] * dt);
      this.vel[j] *= dr; this.vel[j + 2] *= dr;
      this.vel[j + 1] = this.vel[j + 1] * dr + this.par[q + 1] * dt;
      const tb = this.par[q + 6];
      if (tb > 0) {
        // (across its own motion only: a gout is pushed sideways and rolls, it never surges on past where its flight was made to end)
        const x = this.pos[j], y = this.pos[j + 1], z = this.pos[j + 2], sd = this.a[k + 3] * 0.6, kick = tb * dt;
        let kx = kick * Math.sin(clock * 5.3 + y * 2.1 + z * 1.4 + sd), ky = kick * 0.7 * Math.sin(clock * 4.6 + x * 1.8 + z * 1.2 + sd * 1.7), kz = kick * Math.sin(clock * 6.1 + x * 1.3 + y * 2.4 + sd * 2.3);
        const vx = this.vel[j], vy = this.vel[j + 1], vz = this.vel[j + 2], vv = vx * vx + vy * vy + vz * vz;
        if (vv > 1e-4) { const along = (kx * vx + ky * vy + kz * vz) / vv; kx -= vx * along; ky -= vy * along; kz -= vz * along; }
        this.vel[j] += kx; this.vel[j + 1] += ky; this.vel[j + 2] += kz;
      }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const age = 1 - this.life[i] / this.max[i];
      const gp = this.par[q + 7];
      this.a[k] = gp > 0 ? this.par[q + 8] + this.par[q] * age ** gp : Math.max(0.01, this.a[k] + this.par[q] * dt);
      this.a[k + 1] = age;
      this.a[k + 2] += this.par[q + 3] * dt;
      this.b[k + 3] = this.par[q + 4] * (this.par[q + 5] > 0 ? Math.min(1, age / this.par[q + 5]) : 1) * Math.min(1, (1 - age) * 3.2);
    }
    this.live = live;
    this.attrs.pos.needsUpdate = this.attrs.a.needsUpdate = this.attrs.b.needsUpdate = true;
    if (this.attrs.vel) this.attrs.vel.needsUpdate = true;
    if (live === 0) this.points.visible = false;
  }

  /** QA / tests: every live sprite — its position, shape (flames: FLAME_SHAPES) and size (m). */
  qa(): {x: number; y: number; z: number; shape: number; size: number}[] {
    const out: {x: number; y: number; z: number; shape: number; size: number}[] = [];
    for (let i = 0; i < this.cap; i++) if (this.life[i] > 0) out.push({x: this.pos[i * 3], y: this.pos[i * 3 + 1], z: this.pos[i * 3 + 2], shape: Math.floor(this.b[i * 4 + 2]), size: this.a[i * 4]});
    return out;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < this.cap; i++) this.b[i * 4 + 3] = 0;
    this.live = 0;
    this.attrs.b.needsUpdate = true;
    this.points.visible = false;
  }
}

const Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Instanced marks lying on surfaces: the fires' glow (additive, per-frame) or the soot they leave (a fading ring). */
class SurfaceMarks {
  readonly mesh: THREE.InstancedMesh;
  readonly fade: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3(); private readonly s = new THREE.Vector3(); private readonly nrm = new THREE.Vector3();

  constructor(readonly cap: number, glow: boolean, noise: THREE.Texture, time: TNode) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    const mat = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: glow ? -6 : -3,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending});
    mat.name = glow ? 'fire-glow' : 'fire-soot';
    const p = (uv() as TNode).sub(0.5), r = length(p).mul(2), fade = attribute('aFade', 'float') as TNode;
    if (glow) {
      // a hot pool on the surface: bright at the heart, breaking up toward the rim, crawling
      const n = (texture(noise, p.mul(0.9).add(vec2(time.mul(0.11), time.mul(-0.17)))) as TNode).r.mul(0.6).add((texture(noise, p.mul(2.1).add(vec2(time.mul(-0.2), time.mul(0.13)))) as TNode).g.mul(0.4));
      const core = float(1).sub(r).clamp(0, 1);
      const al = core.mul(core).mul(n.mul(1.1).add(0.35)).mul(fade);
      mat.colorNode = mix(vec3(1.0, 0.3, 0.04), vec3(1.0, 0.62, 0.16), core.mul(n).clamp(0, 1));
      mat.opacityNode = al.clamp(0, 1);
      mat.fog = false;
    } else {
      // soot: an irregular dark stain, densest in the middle
      const n = (texture(noise, p.mul(0.8)) as TNode).g.mul(0.65).add((texture(noise, p.mul(2.4)) as TNode).b.mul(0.35));
      const al = smoothstep(0.12, 0.62, float(1).sub(r).clamp(0, 1).mul(n.mul(1.25).add(0.35))).mul(0.8).mul(fade);
      mat.colorNode = vec3(0.012, 0.01, 0.009);
      mat.opacityNode = al.clamp(0, 1);
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = glow ? 'fire-glows' : 'fire-soot';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = glow ? 2 : 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }

  /** Instance i lies on the surface at (x, y, z) with outward normal n, `size` m across, turned `yaw` about the normal. */
  set(i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, yaw: number, fade: number, lift = 0.012): void {
    this.q.setFromUnitVectors(Z, this.nrm.set(nx, ny, nz));
    this.q.multiply(this.q2.setFromAxisAngle(Z, yaw));
    this.m.compose(this.v.set(x + nx * lift, y + ny * lift, z + nz * lift), this.q, this.s.set(size, size, 1));
    this.mesh.setMatrixAt(i, this.m);
    this.fade.setX(i, fade);
  }

  hide(i: number): void {
    this.mesh.setMatrixAt(i, ZERO);
    this.fade.setX(i, 0);
  }

  commit(any: boolean): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
    this.mesh.visible = any;
  }
}

interface Plume { h: FirePlume; x: number; y: number; z: number; idle: number }
type V3 = {x: number; y: number; z: number};
/** Recent body gouts the stream's tongues and smoke may leave from. */
const BODY_KEEP = 64;
/** Seconds the stream's head dies down over, once the last of its flame has arrived. */
const HEAD_FADE = 0.25;
/** The stream's envelope: radius ~ (distance along it / its length)^BLOOM — narrow near the bell, blooming toward its end. */
const BLOOM = 1.2;
/** Fractional particles owed by one source: flames, smoke, sparks, wisps. */
interface Owed { f: number; s: number; e: number; w: number }

/** What the frame needs from the Game besides the fire state. */
export interface FireFrame {
  /** The lance's muzzle in the world while the flamethrower is in the hands (null: not held). */
  muzzle: {x: number; y: number; z: number} | null;
  /** The pilot flame burns (held, a worn tank with fuel). */
  pilot: boolean;
  /** The camera (the light / plumes follow the fires nearest it). */
  eye: {x: number; y: number; z: number};
}

export class FireFx implements FireView {
  readonly group = new THREE.Group();
  readonly light: FlareLight;
  smoke: FireSmokeHost | null = null;
  private readonly noise = fireNoiseTexture();
  private readonly time = uniform(0);
  private readonly flames: FireSprites;
  private readonly puffs: FireSprites;
  private readonly glows: SurfaceMarks;
  private readonly soot: SurfaceMarks;
  /** Soot ring: birth clock per slot (0: free), the slot written next. */
  private readonly sootBorn = new Float32Array(FIRE_FX.soot);
  private sootNext = 0;
  private sootT = 0;
  private clock = 0;
  /** Fractional particles owed per source since the last frame (one accumulator per kind: a source's share is its rate x dt). */
  private readonly owed = new Map<object, Owed>();
  private pilotOwed = 0;
  /** The stream's per-layer debts, and seconds since it lit (its front is at FLAME.speed x that). */
  private readonly jetOwed = {nozzle: 0, core: 0, body: 0, licks: 0, head: 0, smoke: 0, headSmoke: 0, sparks: 0};
  private jetAge = 0;
  /**
   * The stream's head (where it stops: open air or a surface) for this frame — and after the trigger is released, while the last of
   * its flame is still in flight: `wait` s until that flame arrives (it had not yet), then `left` s more of the head.
   */
  private readonly head = {on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, nx: 0, ny: 1, nz: 0, surface: false, e: 0.5, wait: 0, left: 0, span: 1};
  /** The body's recent gouts (ring slot + stamp): the tongues peel off them and the smoke leaves them, wherever the jet has swung. */
  private readonly bodySlots = new Int32Array(BODY_KEEP).fill(-1);
  private readonly bodyStamps = new Uint32Array(BODY_KEEP);
  private bodyNext = 0;
  private readonly probe = {x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, left: 0, size: 0};
  private readonly plumes: Plume[] = [];
  private lit = false;
  private level = 0;
  private readonly lightAt = new THREE.Vector3();
  private readonly tv = new THREE.Vector3(); private readonly tu = new THREE.Vector3(); private readonly tw = new THREE.Vector3();
  private readonly hv = new THREE.Vector3(); private readonly hu = new THREE.Vector3(); private readonly hw = new THREE.Vector3();
  private readonly jit: V3 = {x: 0, y: 0, z: 0};
  /** QA / tests. */
  readonly counts = {flames: 0, smoke: 0, sparks: 0, soot: 0, bursts: 0, plumes: 0};

  constructor(parent: THREE.Object3D) {
    this.group.name = 'fire-fx';
    this.flames = new FireSprites(FIRE_FX.flames, 'flame', this.noise, this.time);
    this.puffs = new FireSprites(FIRE_FX.smoke, 'smoke', this.noise, this.time);
    this.glows = new SurfaceMarks(FIRE_FX.glows, true, this.noise, this.time);
    this.soot = new SurfaceMarks(FIRE_FX.soot, false, this.noise, this.time);
    this.group.add(this.soot.mesh, this.glows.mesh, this.puffs.points, this.flames.points);
    parent.add(this.group);
    const l = FIRE_FX.light;
    this.light = new FlareLight(l.color, 0, l.distance, l.decay);
    this.light.name = 'fire-light';
    this.light.castShadow = false;
    parent.add(this.light);
  }

  /** The station warm-up compiles these (hidden until something burns). */
  warmRoots(): THREE.Object3D[] {
    return [this.group];
  }

  get live(): {flames: number; smoke: number} {
    return {flames: this.flames.live, smoke: this.puffs.live};
  }

  /** QA / tests: the live flame sprites (position, shape, size m). */
  qaFlames(): {x: number; y: number; z: number; shape: number; size: number}[] {
    return this.flames.qa();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // FireView (the rules' cues)

  scorch(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number): void {
    const i = this.sootNext;
    this.sootNext = (this.sootNext + 1) % FIRE_FX.soot;
    this.sootBorn[i] = this.clock + 1e-3;
    this.soot.set(i, x, y, z, nx, ny, nz, r * 2.3, Math.random() * Math.PI * 2, 0, 0.006);
    this.soot.commit(true);
    this.counts.soot++;
  }

  burst(x: number, y: number, z: number, size: number): void {
    this.counts.bursts++;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.5, 1.9) * size;
      this.ball(x + Math.cos(a) * size * 0.3, y + rnd(-0.05, 0.3), z + Math.sin(a) * size * 0.3, Math.cos(a) * sp, rnd(0.9, 2.4), Math.sin(a) * sp, rnd(0.45, 0.8) * size, rnd(0.4, 0.7), rnd(0.9, 1.1), 1, 0.7, 0.5, 1.2, 2.2);
    }
    for (let i = 0; i < 12; i++) this.spark(x + rnd(-0.3, 0.3) * size, y + rnd(0, 0.3), z + rnd(-0.3, 0.3) * size, 2.2);
    for (let i = 0; i < 3; i++) this.puff(x + rnd(-0.2, 0.2), y + rnd(0.3, 0.6), z + rnd(-0.2, 0.2), 1, 1);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Spawners

  /** A standing flame with its foot at (x, y, z), `size` m tall (the shader draws the tongue inside the sprite; it leans a little). */
  private tongue(x: number, y: number, z: number, size: number, life: number, heat: number, alpha: number, rise = 0.16, vx = 0, vz = 0): void {
    this.flames.spawn(x, y + size * 0.45, z, vx, rise, vz, size, life, heat, 1, TONGUE, alpha, size * 0.1, 0, 0, 0, 0.18, rnd(-0.2, 0.2));
    this.counts.flames++;
  }

  /** A rolling gout of fire (the stream, a splash, a wisp breaking off a flame). */
  private ball(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, heat: number, erode: number, alpha: number, grow: number, lift: number, drag: number, fadeIn = 0.1): void {
    this.flames.spawn(x, y, z, vx, vy, vz, size, life, heat, erode, BALL, alpha, grow, lift, drag, rnd(-1.4, 1.4), fadeIn);
    this.counts.flames++;
  }

  /** A turbulent gout of the stream (its body, tongues, head, splash): hides `occ` of what is behind it; `turb` m/s2 buffets it. */
  private roll(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, heat: number, erode: number, alpha: number, grow: number, lift: number, drag: number, occ: number, turb: number, fadeIn = 0.08, growPow = 0): number {
    this.counts.flames++;
    return this.flames.spawn(x, y, z, vx, vy, vz, size, life, heat, erode, ROLL + occ, alpha, grow, lift, drag, rnd(-1.6, 1.6), fadeIn, null, turb, growPow);
  }

  /** A fast hot blob of the stream's core, drawn stretched along its own on-screen motion. */
  private streak(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, heat: number, alpha: number, grow: number, turb: number): void {
    this.flames.spawn(x, y, z, vx, vy, vz, size, life, heat, 0.8, STREAK + 0.1, alpha, grow, 0, 0, 0, 0.02, 0, turb);
    this.counts.flames++;
  }

  private spark(x: number, y: number, z: number, speed: number): void {
    const a = Math.random() * Math.PI * 2, h = rnd(0.15, 0.7) * speed;
    this.flames.spawn(x, y, z, Math.cos(a) * h, rnd(0.8, 1.6) * speed, Math.sin(a) * h, rnd(0.03, 0.055), rnd(0.7, 1.5), 1.4, 0, SPARK, 1, -0.012, -1.6, 0.9, 0, 0.02);
    this.counts.sparks++;
  }

  /**
   * A smoke billow leaving a fire of strength k: dull orange-brown where `glow` is high (lit by the flames it leaves), going dark as it
   * climbs (the shader: its birth colour fades to soot with age).
   */
  private puff(x: number, y: number, z: number, k: number, glow: number, vx = 0, vy = 0, vz = 0): void {
    const g = Math.max(0, Math.min(1, glow)), w = rnd(0.8, 1.15);
    this.puffs.spawn(x, y, z, vx + rnd(-0.16, 0.16), vy + rnd(0.7, 1.15), vz + rnd(-0.16, 0.16), rnd(0.55, 0.85), rnd(3.0, 4.6),
      (0.05 + 0.3 * g) * w, (0.046 + 0.135 * g) * w, (0.042 + 0.045 * g) * w, rnd(0.36, 0.5) * (0.55 + 0.45 * k), rnd(0.32, 0.52), 0.1, 0.45, rnd(-0.35, 0.35), 0.2);
    this.counts.smoke++;
  }

  private share(key: object): Owed {
    let o = this.owed.get(key);
    if (!o) this.owed.set(key, (o = {f: Math.random(), s: Math.random(), e: Math.random(), w: Math.random()}));
    return o;
  }

  // ---------------------------------------------------------------------------------------------------------------------

  /** One frame: spawn from everything that burns, move the rings, lay the glow, age the soot, drive the light and the plumes. */
  frame(dt: number, sys: FireSystem, view: FireFrame): void {
    const step = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    (this.time as unknown as {value: number}).value = this.clock;
    const busy = sys.active || !!view.muzzle || this.head.left > 0;
    if (busy && step > 0) {
      if (view.muzzle && sys.stream.on) this.jet(step, sys, view.muzzle);
      else this.jetOut(step);
      if (view.muzzle && view.pilot && !sys.stream.on) this.pilot(step, view.muzzle);
      for (const p of sys.patches) this.patch(step, p);
      for (const b of sys.burns) this.prop(step, b);
      let n = 0;
      for (const z of sys.alight.keys()) { if (z.nonGraphic || !z.brain.alive) continue; if (n++ >= FIRE_FX.bodies) break; this.body(step, z); }
      if (this.owed.size > 96) this.prune(sys);
    }
    this.flames.update(step, this.clock);
    this.puffs.update(step, this.clock);
    this.lay(sys);
    this.ageSoot(step);
    this.lightUp(step, sys, view.eye);
    this.plume(step, sys);
  }

  /**
   * The stream, from the burner bell `m` to where the rules' aim ray stops (s.reach along it, inside the cone the rules burn): the
   * ignition puff (its first frame), the nozzle flare, the core streaks, the body gouts, tongues peeling off the body, sooty smoke off
   * its far half, and the head where it ends (open air: rolling billows; a surface: a splash running out along it). The front moves at
   * FLAME.speed, so the head shows when the rules' fire would land. Rates: FIRE_FX.stream.
   */
  private jet(dt: number, sys: FireSystem, m: V3): void {
    const s = sys.stream, S = FIRE_FX.stream, o = this.jetOwed;
    const tx = s.ox + s.dx * s.reach, ty = s.oy + s.dy * s.reach, tz = s.oz + s.dz * s.reach;
    const d = this.tv.set(tx - m.x, ty - m.y, tz - m.z), dist = d.length();
    if (dist < 0.05) return;
    d.multiplyScalar(1 / dist);
    // a basis across the jet (u level, w up-ish)
    const u = this.tu.set(d.z, 0, -d.x);
    if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
    u.normalize();
    const w = this.tw.crossVectors(d, u);
    const lit = this.jetAge === 0;
    this.jetAge += dt;
    const front = Math.min(dist, this.jetAge * FLAME.speed);
    // the visible envelope's radius where the flame stops: a little inside the rules' cone there. The jet is narrow for its first
    // metres and blooms toward its end (BLOOM: the body gouts' growth power)
    const eEnd = Math.max(0.12, streamRadius(s.reach) * 0.92);
    const j = this.jit;
    // 1. the ignition: a hot puff out of the bell as the stream lights
    // (no faster than lets it stop short of a close surface: it travels about a quarter of its speed under that drag)
    if (lit) for (let i = 0; i < 6; i++) {
      const sp = Math.min(rnd(2, 5), Math.max(0.5, (dist - 0.2) * 4));
      across(u, w, rnd(0, Math.PI * 2), rnd(0.6, 1.6), j);
      this.roll(m.x + d.x * 0.05, m.y + d.y * 0.05, m.z + d.z * 0.05, d.x * sp + j.x, d.y * sp + j.y, d.z * sp + j.z, rnd(0.1, 0.17), rnd(0.16, 0.26), 1.1, 0.8, 0.55, 1.3, 1.0, 4, 0.1, 0, 0);
    }
    // 2. the nozzle: a white-hot flicker in the bell's mouth
    o.nozzle += dt * S.nozzle;
    while (o.nozzle >= 1) {
      o.nozzle -= 1;
      const at = rnd(0, 0.1), sp = rnd(2.5, 5);
      this.roll(m.x + d.x * at, m.y + d.y * at, m.z + d.z * at, d.x * sp, d.y * sp, d.z * sp, rnd(0.06, 0.1), rnd(0.05, 0.09), 1.4, 0.3, 0.85, 0.8, 0, 3, 0, 0, 0);
    }
    // 3. the core: fast hot streaks along the axis, out to under half way (all the way to a near surface)
    const coreLen = Math.min(dist, Math.max(1.6, 0.38 * dist + 0.6));
    o.core += dt * S.core;
    while (o.core >= 1) {
      o.core -= 1;
      // (spread along this frame's travel: no beads at low frame rates; slower when the surface is too close for a whole frame of flight)
      let sp = FLAME.speed * rnd(1, 1.12);
      const lead = Math.min(coreLen * 0.7, Math.random() * dt * sp);
      let life = (coreLen - lead) / sp;
      if (life < 0.04) { life = 0.04; sp = (coreLen - lead) / life; }
      across(u, w, rnd(0, Math.PI * 2), Math.random() * 0.012, j);
      const s0 = rnd(0.04, 0.055);
      this.streak(m.x + d.x * lead, m.y + d.y * lead, m.z + d.z * lead, (d.x + j.x) * sp, (d.y + j.y) * sp, (d.z + j.z) * sp, s0, life, rnd(1.0, 1.25), rnd(0.45, 0.6), (rnd(0.11, 0.17) - s0) / life, 10);
    }
    // 4. the body: turbulent gouts swelling to the envelope, slowing a little, rising a little, cooling to deep red
    const drag = 0.3, endAt = Math.max(0.3, dist - 0.15);
    o.body += dt * S.body;
    while (o.body >= 1) {
      o.body -= 1;
      let v0 = FLAME.speed * rnd(1.06, 1.2);
      const lead = Math.min(endAt * 0.7, Math.random() * dt * v0 + rnd(0.02, 0.12));
      // (its life is the time it takes to reach the end under that drag: x(t) = v0 (1 - e^-Dt) / D; a surface too close for that
      // flight to last a few frames slows it instead, so it still stops there)
      const go = endAt - lead;
      let life = -Math.log(1 - Math.min(0.95, go * drag / v0)) / drag;
      if (life < 0.06) { life = 0.06; v0 = go * drag / (1 - Math.exp(-drag * life)); }
      across(u, w, rnd(0, Math.PI * 2), Math.sqrt(Math.random()) * 0.045, j);
      const s0 = rnd(0.1, 0.14);
      const slot = this.roll(m.x + d.x * lead, m.y + d.y * lead, m.z + d.z * lead, (d.x + j.x) * v0, (d.y + j.y) * v0, (d.z + j.z) * v0, s0, life, rnd(0.85, 1.05), 0.9, rnd(0.3, 0.4),
        2 * eEnd * rnd(0.6, 0.95) - s0, 1.4, drag, 0.16, 16, 0.02, BLOOM);
      this.bodySlots[this.bodyNext] = slot;
      this.bodyStamps[this.bodyNext] = this.flames.stamp(slot);
      this.bodyNext = (this.bodyNext + 1) % BODY_KEEP;
    }
    // 5. tongues and smoke off the body (wherever it has swung)
    this.offBody(dt, 1);
    // 6. the head, once the flame has got there; after a release it burns on while the last flame is still in flight
    const h = this.head;
    h.x = tx; h.y = ty; h.z = tz; h.dx = d.x; h.dy = d.y; h.dz = d.z; h.nx = s.nx; h.ny = s.ny; h.nz = s.nz; h.surface = s.kind !== 'none'; h.e = eEnd;
    h.wait = Math.max(0, (dist - front) / FLAME.speed);
    h.left = h.span = dist / FLAME.speed + HEAD_FADE;
    h.on = h.wait <= 0;
    if (h.on) this.headFrame(dt, 1);
  }

  /** The stream is out: its debts drop; the head and the gouts still in flight burn on for the flight time (FireFx.head). */
  private jetOut(dt: number): void {
    const o = this.jetOwed, h = this.head;
    this.jetAge = 0;
    o.nozzle = o.core = o.body = 0;
    if (h.left <= 0) { h.on = false; o.licks = o.smoke = o.head = o.headSmoke = o.sparks = 0; return; }
    h.left -= dt;
    h.wait -= dt;
    const k = Math.max(0, Math.min(1, h.left / HEAD_FADE));
    this.offBody(dt, 1);
    h.on = h.wait <= 0 && h.left > 0;
    if (h.on) this.headFrame(dt, k);
  }

  /** A recent body gout still in flight (at least `minAge` through its life): its state in `probe`, else null. */
  private someGout(minAge: number): typeof this.probe | null {
    for (let t = 0; t < 4; t++) {
      const i = Math.floor(Math.random() * BODY_KEEP);
      if (this.flames.read(this.bodySlots[i], this.bodyStamps[i], this.probe) && this.probe.age >= minAge) return this.probe;
    }
    return null;
  }

  /** Flame tongues tearing off the body's edge (mostly its upper side) and rising; sooty smoke leaving its far half. */
  private offBody(dt: number, k: number): void {
    const S = FIRE_FX.stream, o = this.jetOwed;
    o.licks += dt * S.licks * k;
    while (o.licks >= 1) {
      o.licks -= 1;
      const g = this.someGout(0.15);
      if (!g || g.left < 0.1) continue;
      const sp = Math.hypot(g.vx, g.vy, g.vz) || 1, dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp;
      // (across its motion: pu level, pw up-ish; the angle is about pw, so most tongues leave the top)
      let ux = dz, uz = -dx;
      const ul = Math.hypot(ux, uz);
      if (ul < 1e-3) { ux = 1; uz = 0; } else { ux /= ul; uz /= ul; }
      const wx = dy * uz, wy = dz * ux - dx * uz, wz = -dy * ux;
      const a = Math.PI / 2 + rnd(-1.7, 1.7), c = Math.cos(a), sn = Math.sin(a);
      const ox = ux * c + wx * sn, oy = wy * sn, oz = uz * c + wz * sn;
      const off = g.size * rnd(0.25, 0.45), out = rnd(0.5, 1.4), keep = rnd(0.25, 0.5);
      // (it lives no longer than the gout it leaves has left: slower than the gout, it never gets past where the jet ends)
      this.roll(g.x + ox * off, g.y + oy * off, g.z + oz * off, g.vx * keep + ox * out, g.vy * keep + oy * out + rnd(0.6, 1.3), g.vz * keep + oz * out,
        Math.max(0.12, g.size * rnd(0.3, 0.5)), Math.min(rnd(0.2, 0.36), g.left), rnd(0.8, 0.98), 1, 0.5, 0.6, 3.2, 2.4, 0.25, 10, 0.08);
    }
    o.smoke += dt * S.smoke * k;
    while (o.smoke >= 1) {
      o.smoke -= 1;
      const g = this.someGout(0.5);
      if (g) this.puff(g.x, g.y + g.size * 0.35, g.z, 0.8, 0.55, g.vx * 0.15, 0, g.vz * 0.15);
    }
  }

  /** The stream's head at strength k: rolling billows where it ends in open air, or the splash on the surface it hits; smoke off it. */
  private headFrame(dt: number, k: number): void {
    const h = this.head, S = FIRE_FX.stream, o = this.jetOwed;
    const ceil = h.surface && h.ny < -0.5;
    if (!h.surface) {
      // open air: the flame's end rolls over itself into billows that rise and go to smoke (their centres stay about the reach)
      const u = this.hu.set(h.dz, 0, -h.dx);
      if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
      u.normalize();
      const w = this.hw.crossVectors(this.hv.set(h.dx, h.dy, h.dz), u);
      o.head += dt * S.head * k;
      while (o.head >= 1) {
        o.head -= 1;
        const back = rnd(0.3, 1.0), a = rnd(0, Math.PI * 2), c = Math.cos(a), sn = Math.sin(a), off = h.e * rnd(0, 0.55), out = rnd(0.4, 1.5), fwd = rnd(0.4, 1.8);
        const ox = u.x * c + w.x * sn, oy = u.y * c + w.y * sn, oz = u.z * c + w.z * sn;
        this.roll(h.x - h.dx * back + ox * off, h.y - h.dy * back + oy * off, h.z - h.dz * back + oz * off, h.dx * fwd + ox * out, h.dy * fwd + oy * out + rnd(0.4, 1.1), h.dz * fwd + oz * out,
          h.e * rnd(0.7, 1.1), rnd(0.4, 0.65), rnd(0.78, 0.95), 1, rnd(0.34, 0.44) * (0.4 + 0.6 * k), 0.9, 2.6, 3.2, 0.3, 9, 0.1);
      }
    } else {
      // a surface: the splash — the flame runs on along it the way the jet was going and fans out, curls off it and climbs
      const n = this.hv.set(h.nx, h.ny, h.nz);
      const t1 = this.hu.set(n.y, -n.x, 0);
      if (t1.lengthSq() < 1e-4) t1.set(0, n.z, -n.y);
      t1.normalize();
      const t2 = this.hw.crossVectors(n, t1);
      const dn = h.dx * n.x + h.dy * n.y + h.dz * n.z, rx = h.dx - n.x * dn, ry = h.dy - n.y * dn, rz = h.dz - n.z * dn;
      o.head += dt * S.splash * k;
      const big = Math.max(0.8, Math.min(1.4, h.e / 0.45)); // (a splash in the bloom is bigger than one close to the bell)
      while (o.head >= 1) {
        o.head -= 1;
        const a = rnd(0, Math.PI * 2), c = Math.cos(a), sn = Math.sin(a);
        let fx = t1.x * c + t2.x * sn + rx * 1.1, fy = t1.y * c + t2.y * sn + ry * 1.1, fz = t1.z * c + t2.z * sn + rz * 1.1;
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;
        const sp = rnd(1.8, 4.8) * big, off = rnd(0.5, 1.3);
        this.roll(h.x + n.x * 0.08, h.y + n.y * 0.08, h.z + n.z * 0.08, fx * sp + n.x * off, fy * sp + n.y * off + (ceil ? 0 : 0.5), fz * sp + n.z * off,
          rnd(0.34, 0.66) * big, rnd(0.34, 0.58), rnd(0.9, 1.08), 1, rnd(0.45, 0.55) * (0.4 + 0.6 * k), 1.1 * big, ceil ? 0.3 : 2.4, 3.2, 0.42, 4, 0.06);
      }
      o.sparks += dt * 10 * k;
      while (o.sparks >= 1) { o.sparks -= 1; this.spark(h.x + n.x * 0.1, h.y + n.y * 0.1, h.z + n.z * 0.1, 1.6); }
    }
    o.headSmoke += dt * S.headSmoke * k;
    while (o.headSmoke >= 1) {
      o.headSmoke -= 1;
      if (h.surface) this.puff(h.x + h.nx * 0.3 + rnd(-0.2, 0.2), h.y + (ceil ? -0.15 : 0.45), h.z + h.nz * 0.3 + rnd(-0.2, 0.2), 0.8, 0.9);
      else this.puff(h.x - h.dx * 0.3 + rnd(-0.3, 0.3), h.y + rnd(0.1, 0.45), h.z - h.dz * 0.3 + rnd(-0.3, 0.3), 0.75, 0.8, h.dx, 0, h.dz);
    }
  }

  /** The pilot flame at the burner while the lance is held and fuelled. */
  private pilot(dt: number, m: {x: number; y: number; z: number}): void {
    this.pilotOwed += dt * 22;
    while (this.pilotOwed >= 1) {
      this.pilotOwed -= 1;
      // (its foot sits in the burner bell's mouth; seen from behind the lance it licks up over the bell's rim)
      this.tongue(m.x + rnd(-0.004, 0.004), m.y + 0.015, m.z + rnd(-0.004, 0.004), rnd(0.1, 0.135), rnd(0.12, 0.18), 0.9, 0.8, 0.04);
    }
  }

  /** A clinging patch: flames standing on its surface (taller in its middle, climbing a wall, rolling under a ceiling), sparks, smoke. */
  private patch(dt: number, p: FirePatch): void {
    const k = patchStrength(p);
    if (k <= 0.02) return;
    const o = this.share(p), r = patchRadius(p);
    const ceil = p.face === 'ceiling', wall = p.face === 'wall';
    // a basis in the surface
    const t1 = this.tu.set(p.ny, -p.nx, 0);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = this.tw.set(p.ny * t1.z - p.nz * t1.y, p.nz * t1.x - p.nx * t1.z, p.nx * t1.y - p.ny * t1.x);
    o.f += dt * (3.5 + 6.5 * k);
    while (o.f >= 1) {
      o.f -= 1;
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.8, ca = Math.cos(a) * d, sa = Math.sin(a) * d;
      const x = p.x + t1.x * ca + t2.x * sa + p.nx * 0.08, y = p.y + t1.y * ca + t2.y * sa + p.ny * 0.08, z = p.z + t1.z * ca + t2.z * sa + p.nz * 0.08;
      const edge = 1 - 0.5 * (d / Math.max(0.01, r)); // (taller in the middle)
      if (ceil) {
        for (let i = 0; i < 2; i++) { const b = a + i * 2.4 + rnd(-0.5, 0.5), bd = Math.sqrt(Math.random()) * r * 0.85; this.ball(p.x + Math.cos(b) * bd, p.y - rnd(0.07, 0.13), p.z + Math.sin(b) * bd, Math.cos(b) * rnd(0.3, 0.9), 0.05, Math.sin(b) * rnd(0.3, 0.9), rnd(0.28, 0.46) * (0.6 + 0.4 * k), rnd(0.45, 0.8), rnd(0.75, 0.95), 1, 0.62, 0.2, 0.3, 1.2); }
      }
      else this.tongue(x, y - (wall ? r * 0.25 : 0), z, (0.5 + 0.8 * k) * edge * rnd(0.8, 1.2) * (wall ? 0.85 : 1), rnd(0.6, 1.05), rnd(0.85, 1.1), 0.85, rnd(0.1, 0.3), p.nx * 0.12, p.nz * 0.12);
    }
    // wisps breaking off the flames' tips
    o.w += dt * 2.2 * k;
    while (o.w >= 1 && !ceil) { o.w -= 1; this.ball(p.x + p.nx * 0.12 + rnd(-r, r) * 0.5, p.y + (0.35 + 0.5 * k) * rnd(0.6, 1), p.z + p.nz * 0.12 + rnd(-r, r) * 0.5, rnd(-0.2, 0.2), rnd(1.3, 2.1), rnd(-0.2, 0.2), rnd(0.16, 0.28), rnd(0.3, 0.5), rnd(0.8, 1), 1, 0.6, 0.1, 0.6, 0.5); }
    if (ceil) o.w = 0;
    o.e += dt * 1.3 * k;
    while (o.e >= 1) { o.e -= 1; this.spark(p.x + rnd(-r, r) * 0.6, p.y + 0.15, p.z + rnd(-r, r) * 0.6, 1.3); }
    o.s += dt * (0.9 + 2 * k);
    while (o.s >= 1) { o.s -= 1; this.puff(p.x + p.nx * 0.2 + rnd(-r, r) * 0.45, p.y + (ceil ? -0.15 : rnd(0.55, 0.95) * (0.5 + 0.5 * k)), p.z + p.nz * 0.2 + rnd(-r, r) * 0.45, k, 1); }
  }

  /** A burning prop: flames standing on its top and up its sides, wisps, sparks, heavy smoke; dying down as it collapses. */
  private prop(dt: number, b: {id: object; box: {min: {x: number; y: number; z: number}; max: {x: number; y: number; z: number}}; age: number; seconds: number}): void {
    const o = this.share(b.id), t = b.age / b.seconds;
    const up = Math.min(1, t * 5), down = 1 - Math.max(0, (t - 0.68) / 0.32) * 0.75; // (catches fast; sinks with the collapse)
    const w = b.box.max.x - b.box.min.x, dp = b.box.max.z - b.box.min.z, h = (b.box.max.y - b.box.min.y) * (t > 0.62 ? 1 - 0.9 * Math.min(1, (t - 0.62) / 0.38) : 1);
    const area = Math.max(0.1, w * dp), big = 0.75 + 0.25 * Math.min(1, area), sc = up * (0.6 + 0.4 * down);
    o.f += dt * Math.max(7, Math.min(30, 5 + 9 * area + 6 * h)) * up * down;
    while (o.f >= 1) {
      o.f -= 1;
      if (Math.random() < (h > 1.2 ? 0.3 : 0.5)) this.tongue(rnd(b.box.min.x + w * 0.1, b.box.max.x - w * 0.1), b.box.min.y + h - 0.04, rnd(b.box.min.z + dp * 0.1, b.box.max.z - dp * 0.1), rnd(0.7, 1.25) * big * sc, rnd(0.6, 1.05), rnd(0.9, 1.15), 0.85, rnd(0.12, 0.3));
      else {
        const side = Math.floor(Math.random() * 4);
        const x = side === 0 ? b.box.min.x - 0.06 : side === 1 ? b.box.max.x + 0.06 : rnd(b.box.min.x, b.box.max.x);
        const z = side === 2 ? b.box.min.z - 0.06 : side === 3 ? b.box.max.z + 0.06 : rnd(b.box.min.z, b.box.max.z);
        this.tongue(x, b.box.min.y + h * rnd(0, 0.7), z, rnd(0.55, 1.0) * big * sc, rnd(0.55, 0.95), rnd(0.85, 1.1), 0.82, rnd(0.12, 0.3));
      }
    }
    o.w += dt * 3 * up * down;
    while (o.w >= 1) { o.w -= 1; this.ball(rnd(b.box.min.x, b.box.max.x), b.box.min.y + h + rnd(0.3, 0.8), rnd(b.box.min.z, b.box.max.z), rnd(-0.25, 0.25), rnd(1.4, 2.3), rnd(-0.25, 0.25), rnd(0.18, 0.32), rnd(0.3, 0.55), rnd(0.8, 1), 1, 0.6, 0.1, 0.6, 0.5); }
    o.e += dt * 3.5 * up * down;
    while (o.e >= 1) { o.e -= 1; this.spark(rnd(b.box.min.x, b.box.max.x), b.box.min.y + h, rnd(b.box.min.z, b.box.max.z), 1.7); }
    o.s += dt * 4 * up;
    while (o.s >= 1) { o.s -= 1; this.puff(rnd(b.box.min.x, b.box.max.x), b.box.min.y + h + rnd(0.5, 0.9), rnd(b.box.min.z, b.box.max.z), 1, 1); }
  }

  /** A burning body: flames about its trunk (never on a non-graphic body: the caller filters). */
  private body(dt: number, z: FireEnemy): void {
    const o = this.share(z), b = z.brain, r = b.stats.radius, h = b.stats.height ?? 1.7;
    o.f += dt * 9;
    while (o.f >= 1) {
      o.f -= 1;
      const a = Math.random() * Math.PI * 2, d = r * rnd(0.8, 1.2); // (about it, not inside it: its own surface would hide them)
      this.tongue(b.x + Math.cos(a) * d, b.y + h * rnd(0.12, 0.72), b.z + Math.sin(a) * d, rnd(0.45, 0.8), rnd(0.45, 0.75), rnd(0.85, 1.05), 0.8, rnd(0.15, 0.35));
    }
    o.s += dt * 0.8;
    while (o.s >= 1) { o.s -= 1; this.puff(b.x, b.y + h + 0.2, b.z, 0.6, 0.8); }
  }

  /** Spawn accumulators of sources that are gone. */
  private prune(sys: FireSystem): void {
    const keep = new Set<object>(sys.patches);
    for (const b of sys.burns) keep.add(b.id);
    for (const z of sys.alight.keys()) keep.add(z);
    for (const k of this.owed.keys()) if (!keep.has(k)) this.owed.delete(k);
  }

  /** The glow pools: one under / on every patch and under every burning prop. */
  private lay(sys: FireSystem): void {
    let i = 0;
    const cap = FIRE_FX.glows;
    for (const p of sys.patches) {
      if (i >= cap) break;
      const k = patchStrength(p);
      if (k <= 0.02) continue;
      const fl = 0.8 + 0.2 * Math.sin(this.clock * 9 + p.id * 1.7) * Math.sin(this.clock * 5.3 + p.id);
      this.glows.set(i++, p.x, p.y, p.z, p.nx, p.ny, p.nz, patchRadius(p) * 2.5, p.id * 2.4, Math.min(1, 0.25 + k) * fl);
    }
    for (const b of sys.burns) {
      if (i >= cap) break;
      const t = b.age / b.seconds, size = Math.max(b.box.max.x - b.box.min.x, b.box.max.z - b.box.min.z) * 1.5 + 0.7;
      this.glows.set(i++, b.base.x, b.base.y, b.base.z, 0, 1, 0, size, 0.7, Math.min(1, t * 4) * (0.85 + 0.15 * Math.sin(this.clock * 8)));
    }
    const any = i > 0;
    if (!any && !this.glows.mesh.visible) return;
    for (; i < cap; i++) this.glows.hide(i);
    this.glows.commit(any);
  }

  private ageSoot(dt: number): void {
    this.sootT += dt;
    if (this.sootT < 0.5 || !this.soot.mesh.visible) return;
    this.sootT = 0;
    let any = false;
    for (let i = 0; i < FIRE_FX.soot; i++) {
      const born = this.sootBorn[i];
      if (born <= 0) continue;
      const age = this.clock - born;
      if (age >= FIRE_FX.sootSeconds) { this.sootBorn[i] = 0; this.soot.hide(i); continue; }
      any = true;
      // (it darkens in over the fire's first seconds — the flames hide it — and fades over its last quarter)
      this.soot.fade.setX(i, Math.min(1, age / 3) * Math.min(1, (FIRE_FX.sootSeconds - age) / (FIRE_FX.sootSeconds * 0.25)));
    }
    this.soot.commit(any);
  }

  /** The fire light sits over the strongest fire near the camera; its level follows the fire there, flickering. */
  private lightUp(dt: number, sys: FireSystem, eye: {x: number; y: number; z: number}): void {
    let best = 0, bx = 0, by = 0, bz = 0, total = 0;
    const consider = (x: number, y: number, z: number, level: number) => {
      const sc = level / (1 + 0.03 * ((x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2));
      if (sc > best) { best = sc; bx = x; by = y; bz = z; }
    };
    // (a fire on a wall lights the room from about a metre off it: closer, the inverse square bleaches the wall behind its own flames)
    for (const p of sys.patches) { const k = patchStrength(p), off = p.face === 'wall' ? 0.9 : 0.4; if (k > 0.05) consider(p.x + p.nx * off, p.y + p.ny * off + (p.face === 'ceiling' ? -0.45 : 0.35), p.z + p.nz * off, p.face === 'ceiling' ? k * 0.55 : k); }
    for (const b of sys.burns) consider(b.base.x, b.box.max.y + 0.3, b.base.z, 1.2);
    // (a stream ending in open air lights the room about its head from the moment the flame gets there; one hitting a surface lights it
    // through the patch it leaves there — the game's stream light already lights the near side, and both at once wash the surface out)
    const h = this.head, air = h.on && !h.surface, hx = h.x - h.dx * 0.5, hy = h.y + 0.2, hz = h.z - h.dz * 0.5;
    if (air) consider(hx, hy, hz, 1);
    if (best > 0) {
      // (everything burning within 3.5 m of it adds to it, up to a ceiling)
      for (const p of sys.patches) if (Math.hypot(p.x - bx, p.y - by, p.z - bz) < 3.5) total += patchStrength(p);
      for (const b of sys.burns) if (Math.hypot(b.base.x - bx, b.base.y - by, b.base.z - bz) < 3.5) total += 1.2;
      if (air && Math.hypot(hx - bx, hy - by, hz - bz) < 3.5) total += 1;
    }
    const target = best > 0 ? Math.min(1.7, 0.35 + 0.5 * total) : 0;
    if (best > 0) {
      // (a far jump: straight there while dark, else ease — the window the atmosphere computes follows the light)
      if (this.level < 0.05 || this.lightAt.distanceToSquared(this.tv.set(bx, by, bz)) > 36) this.lightAt.set(bx, by, bz);
      else this.lightAt.lerp(this.tv.set(bx, by, bz), Math.min(1, dt * 5));
      this.light.position.copy(this.lightAt);
    }
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 9 : 4));
    if (this.level < 0.01 && target === 0) {
      if (this.lit) { this.lit = false; this.light.intensity = 0; this.smoke?.removeScatterLight?.(this.light); this.light.clearWindow(); }
      this.level = 0;
      return;
    }
    if (!this.lit) { this.lit = true; this.smoke?.addScatterLight?.(this.light); }
    const fl = 0.86 + 0.09 * Math.sin(this.clock * 11.3) + 0.07 * Math.sin(this.clock * 23.7 + 1.3) + 0.05 * Math.sin(this.clock * 4.1);
    this.light.intensity = FIRE_FX.light.intensity * this.level * fl;
  }

  /** Real smoke in the fog march over the strongest fires (the atmosphere's emitters; at most FIRE_FX.plumes). */
  private plume(dt: number, sys: FireSystem): void {
    const host = this.smoke;
    for (const pl of this.plumes) pl.idle += dt;
    if (host?.addSmokeEmitter) {
      let used = 0;
      for (const v of sys.spots) {
        if (v.level < 0.45 || used >= FIRE_FX.plumes) continue;
        used++;
        let pl = this.plumes.find(q => Math.hypot(q.x - v.x, q.z - v.z) < 3 && Math.abs(q.y - v.y) < 2.5);
        if (!pl) {
          if (this.plumes.length >= FIRE_FX.plumes) continue;
          const c = FIRE_FX.plume;
          const h = host.addSmokeEmitter({x: v.x, y: v.y + 0.6, z: v.z, color: c.color, rate: c.rate, radius: c.radius, life: c.life, density: c.density});
          if (!h) continue;
          this.plumes.push((pl = {h, x: v.x, y: v.y, z: v.z, idle: 0}));
          this.counts.plumes++;
        } else if (Math.hypot(pl.x - v.x, pl.y - v.y, pl.z - v.z) > 0.5) { pl.x = v.x; pl.y = v.y; pl.z = v.z; pl.h.setPos?.(v.x, v.y + 0.6, v.z); }
        pl.idle = 0;
      }
    }
    for (let i = this.plumes.length - 1; i >= 0; i--) if (this.plumes[i].idle > 0.6) { this.plumes[i].h.stop?.(3); this.plumes.splice(i, 1); }
  }

  /** Everything gone at once (section teardown): rings emptied, glow / soot hidden, the light off, the plumes dropped. */
  clear(): void {
    this.flames.clear();
    this.puffs.clear();
    for (let i = 0; i < FIRE_FX.glows; i++) this.glows.hide(i);
    this.glows.commit(false);
    for (let i = 0; i < FIRE_FX.soot; i++) this.soot.hide(i);
    this.sootBorn.fill(0);
    this.soot.commit(false);
    this.owed.clear();
    this.pilotOwed = 0;
    const o = this.jetOwed;
    o.nozzle = o.core = o.body = o.licks = o.head = o.smoke = o.headSmoke = o.sparks = 0;
    this.jetAge = 0;
    this.head.on = false;
    this.head.left = this.head.wait = 0;
    this.bodySlots.fill(-1);
    for (const pl of this.plumes) pl.h.stop?.(0);
    this.plumes.length = 0;
    if (this.lit) { this.lit = false; this.smoke?.removeScatterLight?.(this.light); }
    this.light.intensity = 0;
    this.light.clearWindow();
    this.level = 0;
  }
}
