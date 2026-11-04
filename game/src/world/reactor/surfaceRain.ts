// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): RAIN on the surface after the win — user: "It should be
// raining! And the fog is now cleared!". Code-driven dynamic effect (root CLAUDE.md texture rule: rain is exempt); no texture, no model.
//
// Two bounded streak layers, each ONE draw of a fixed set of thin camera-facing quads whose motion is computed entirely in the vertex
// shader (no per-drop objects, no physics, no CPU work per drop):
//  - NEAR: a box round the eye (SURFACE_RAIN.near: ±half m, `below` .. `above` m) with the drops WORLD-ANCHORED (each drop's position
//    is a world-space pattern wrapped into the box, so walking never drags the rain along); faded out toward the box's edge, widened
//    to >= 1 px with distance (alpha scaled down to keep its energy: no aliasing shimmer); drawn only while the eye is outside;
//  - APERTURE column: the drops falling through the roof's single opening, seen from inside the pit (the one natural exception to
//    "sheltered indoors"), clipped to the opening's disc and fading out as they fall into the warm pit air; drawn only while the eye is
//    in the pit (outside, the near layer covers the opening).
// SHELTER: every drop is hidden below the RAIN FLOOR at its x / z (a small R32F data texture, buildRainFloor; read with textureLoad in
// the vertex stage, CPU mirror rainFloorAt): the open ground, the building volumes (their tops), the stair head-house roof (ENDING's
// shelters) — and the aperture, where the floor drops far into the pit. So no point under a roof, inside a building or anywhere in the
// pit (but under the opening) ever gets rain. Plain uniforms only (no uniformArray), never a shadow caster, no volumetric-march change.
// Task studio-alpha-reactor-ending-polish-20261104-034806-01 (lane SPLASH; user: "rain drops are not producing splashes when hitting the
// ground outside, they should!"): the floor map is also where the SPLASHES land (surfaceSplash.ts), so it now holds the true surface
// heights — the walkable deck at site.y, the city ground disc 0.03 m under it (surfaceCity.ts SURFACE_LAYERS.groundBelow) — on 0.5 m
// cells (the level grid's CELL: the walk rects' edges fall on texel edges), the PLANT's structures (vent-tower stacks / plinths, the
// plenums, ducts, sleepers, the compound wall's piers / buttresses: rain stops on them, never falls through), and it reaches far
// enough round the yard for the splashes' view radius.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, abs, attribute, cameraPosition, clamp, cross, float, floor, int, ivec2, length, max, min, mix, normalize, smoothstep, texture, uniform, varying, vec3, vec4} from 'three/tsl';
import type {ReactorRect} from '../../gen/reactor/reactorTypes';
import {footprintCorners, type CityFootprint, type SurfaceCityPlan} from './surfacePlan';
import type {SurfacePlantPlan} from './surfacePlantPlan';
import type {SurfaceSite} from './surfaceSite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** Rain tunables (m, s, linear colours). */
export const SURFACE_RAIN = {
  near: {count: 5200, half: 19, below: 7, above: 15},
  column: {count: 1300, above: 12, depth: 30, fade: 22},
  /** Fall speed range (m/s) and the streak's length (the distance fallen in this long, s). */
  speed: [8.2, 10.6] as readonly [number, number], streakS: 0.06,
  /** Streak width near the eye (m), the pixel floor's widening factor, the opacity at full rain. */
  width: 0.0105, pxK: 1.15, alpha: 0.3,
  /** Wind (m/s, x / z) and its slow gusting (fraction). */
  wind: [1.3, 0.55] as readonly [number, number], gust: 0.45,
  /** Streak colour (lit by the overcast sky) and the beam's blue near its axis. */
  colour: [0.55, 0.6, 0.66] as readonly [number, number, number], beamGain: 1.6, beamR: 7,
  /** The rain-floor map: cell (m; the level grid's CELL) and the margin round the yard it covers (the near box's / the splashes'
   *  reach from any surface eye: surfaceSplash.ts SURFACE_SPLASH.far + the eye gate's pad). */
  floorCell: 0.5, floorPad: 34,
  /** The city ground disc lies this far under the walkable deck (surfaceCity.ts SURFACE_LAYERS.groundBelow reads it). */
  groundBelow: 0.03,
  /** The floor under the aperture (m below the ground): the drops keep falling into the pit. */
  holeDrop: 90,
  /** Time wraps after this long (s): float precision of the falling pattern (a one-frame jump every 10 minutes). */
  period: 600,
} as const;

// ---------------------------------------------------------------------------------------------------------------------------
// The rain floor (pure)

/**
 * Rain floor height map: drops are drawn only ABOVE the floor at their x / z. `ground` = the walkable deck's height (site.y), `low` =
 * the city ground disc's (ground - groundBelow): a texel at either is open ground a splash may land on.
 */
export interface RainFloorMap { x0: number; z0: number; cell: number; w: number; h: number; data: Float32Array; ground: number; low: number }

/**
 * The surface's rain floor: the city ground disc everywhere and the walkable deck on the walk cells, the TOP of every building / tank /
 * vehicle footprint (rain never shows inside a model) and of the plant's structures (`plant`: the vent towers, duct runs, piers),
 * ENDING's shelters (their roofs), and far below the ground over the aperture. Covers the yard + floorPad; outside it the edge texels
 * hold (clamped reads), which the construction keeps at the ground.
 */
export function buildRainFloor(site: SurfaceSite, plan: Pick<SurfaceCityPlan, 'plaza' | 'placements'> | null, plant?: Pick<SurfacePlantPlan, 'towers' | 'parts'> | null): RainFloorMap {
  const R = SURFACE_RAIN, c = R.floorCell, P = plan?.plaza ?? site.bounds;
  const x0 = Math.floor(P.x0 - R.floorPad), z0 = Math.floor(P.z0 - R.floorPad);
  const w = Math.ceil((P.x1 + R.floorPad - x0) / c) + 1, h = Math.ceil((P.z1 + R.floorPad - z0) / c) + 1;
  // the city ground disc everywhere; the walkable deck on the walk rects' cells (a cell whose centre lies on one)
  const low = site.y - R.groundBelow;
  const data = new Float32Array(w * h).fill(low);
  const raise = (i: number, v: number) => { if (v > data[i]) data[i] = v; };
  const cells = (r: ReactorRect, f: (i: number) => void) => {
    for (let iz = Math.max(1, Math.floor((r.z0 - z0) / c)); iz <= Math.min(h - 2, Math.floor((r.z1 - z0 - 1e-6) / c)); iz++) {
      for (let ix = Math.max(1, Math.floor((r.x0 - x0) / c)); ix <= Math.min(w - 2, Math.floor((r.x1 - x0 - 1e-6) / c)); ix++) f(iz * w + ix);
    }
  };
  for (const r of site.walk) cells(r, i => {
    const ix = i % w, iz = (i - ix) / w, cx = x0 + (ix + 0.5) * c, cz = z0 + (iz + 0.5) * c;
    if (cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1) raise(i, site.y);
  });
  /** A volume (oriented footprint, its top): every cell whose centre lies inside it (one cell of the map's border always stays the ground). */
  const volume = (p: CityFootprint, top: number) => {
    const cs = footprintCorners(p);
    const bx0 = Math.max(1, Math.floor((Math.min(...cs.map(q => q[0])) - x0) / c)), bx1 = Math.min(w - 2, Math.floor((Math.max(...cs.map(q => q[0])) - x0) / c));
    const bz0 = Math.max(1, Math.floor((Math.min(...cs.map(q => q[1])) - z0) / c)), bz1 = Math.min(h - 2, Math.floor((Math.max(...cs.map(q => q[1])) - z0) / c));
    for (let iz = bz0; iz <= bz1; iz++) for (let ix = bx0; ix <= bx1; ix++) {
      if (inPoly(cs, x0 + (ix + 0.5) * c, z0 + (iz + 0.5) * c)) raise(iz * w + ix, top);
    }
  };
  // building volumes (their tops)
  for (const p of plan?.placements ?? []) volume(p, p.y + p.h);
  // the plant: the vent towers' stacks and plinths, the duct runs, the compound wall (a buttress by its high end)
  for (const t of plant?.towers ?? []) {
    volume({x: t.x, z: t.z, yaw: t.yaw, hw: t.plinth.hw, hd: t.plinth.hd}, t.y + t.plinth.h);
    volume({x: t.x, z: t.z, yaw: t.yaw, hw: t.hw, hd: t.hd}, t.y + t.h);
  }
  for (const q of plant?.parts ?? []) volume(q, Math.max(q.y1, q.y1b ?? q.y1));
  for (const s of site.shelters) cells(s.rect, i => raise(i, s.roofY));
  // the aperture: the floor falls into the pit (a cell whose centre lies inside the disc)
  const o = site.hole;
  cells({x0: o.x - o.r, z0: o.z - o.r, x1: o.x + o.r, z1: o.z + o.r}, i => {
    const ix = i % w, iz = (i - ix) / w;
    if (Math.hypot(x0 + (ix + 0.5) * c - o.x, z0 + (iz + 0.5) * c - o.z) < o.r) data[i] = site.y - R.holeDrop;
  });
  return {x0, z0, cell: c, w, h, data, ground: site.y, low};
}

function inPoly(P: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, az] = P[i], [bx, bz] = P[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** CPU mirror of the shader's floor read (nearest texel, clamped to the map). */
export function rainFloorAt(m: RainFloorMap, x: number, z: number): number {
  const ix = Math.min(m.w - 1, Math.max(0, Math.floor((x - m.x0) / m.cell))), iz = Math.min(m.h - 1, Math.max(0, Math.floor((z - m.z0) / m.cell)));
  return m.data[iz * m.w + ix];
}

/** Does rain fall at this world point (above the floor)? */
export const rainsAt = (m: RainFloorMap, x: number, y: number, z: number): boolean => y > rainFloorAt(m, x, z);

// ---------------------------------------------------------------------------------------------------------------------------
// The GPU layer

/** Per-layer uniforms (the runtime writes them each frame while the layer is drawn). */
export interface RainUniforms {
  /** Box min corner (world) and size (m). */
  boxMin: {value: THREE.Vector3}; boxSize: {value: THREE.Vector3};
  /** Wrapped clock (s) and the integrated wind offset (m, wrapped). */
  t: {value: number}; windOff: {value: THREE.Vector2};
  /** Current wind (m/s), intensity 0..1, the pixel angle (rad per px) of the camera. */
  wind: {value: THREE.Vector2}; on: {value: number}; px: {value: number};
  /** Clip disc (x, z, r, enabled 0 / 1) and the depth fade (ground y, fade length; length 0 = none). */
  disc: {value: THREE.Vector4}; fade: {value: THREE.Vector2};
  /** Fade-out radius round the eye (m; 0 = none) and the beam (x, z, on, unused). */
  reach: {value: number}; beam: {value: THREE.Vector4};
}

function rainUniforms(): RainUniforms {
  return {
    boxMin: uniform(new THREE.Vector3()), boxSize: uniform(new THREE.Vector3(1, 1, 1)), t: uniform(0), windOff: uniform(new THREE.Vector2()),
    wind: uniform(new THREE.Vector2(...SURFACE_RAIN.wind)), on: uniform(0), px: uniform(0.0014), disc: uniform(new THREE.Vector4(0, 0, 1, 0)),
    fade: uniform(new THREE.Vector2(0, 0)), reach: uniform(0), beam: uniform(new THREE.Vector4(0, 0, 0, 0)),
  } as unknown as RainUniforms;
}

/** The drop quads: position = the drop's seed in [0, 1)^3, rainAux = (side -1 / 1, end 0 = head / 1 = tail, speed seed). */
export function rainGeometry(count: number, seed: number): THREE.BufferGeometry {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pos = new Float32Array(count * 12), aux = new Float32Array(count * 12), idx = new Uint32Array(count * 6);
  const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
  for (let d = 0; d < count; d++) {
    const a = rnd(), b = rnd(), c = rnd(), sp = rnd();
    for (let k = 0; k < 4; k++) {
      const o = (d * 4 + k) * 3;
      pos[o] = a; pos[o + 1] = b; pos[o + 2] = c;
      aux[o] = corners[k][0]; aux[o + 1] = corners[k][1]; aux[o + 2] = sp;
    }
    const v = d * 4, o = d * 6;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rainAux', new THREE.BufferAttribute(aux, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // the drops are placed in the vertex shader: an honest huge bound (the mesh is never frustum-culled)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

/** The rain floor as an R32F data texture (textureLoad only: no filtering, no float-filterable feature needed). */
export function rainFloorTexture(m: RainFloorMap): THREE.DataTexture {
  const t = new THREE.DataTexture(m.data, m.w, m.h, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  t.name = 'reactor-surface-rain-floor';
  return t;
}

/** World-space wrap of v into [lo, lo + size) (floor-based: the same on both backends for negative values). */
const wrap = (v: N, lo: N, size: N): N => n(v).sub(lo).sub(n(size).mul(floor(n(v).sub(lo).div(size)))).add(lo);

function rainMaterial(u: RainUniforms, floorTex: THREE.DataTexture, m: RainFloorMap): MeshBasicNodeMaterial {
  const R = SURFACE_RAIN;
  const mat = new MeshBasicNodeMaterial({name: 'reactor-surface-rain', transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide});
  mat.forceSinglePass = true; // one draw (three would split a transparent double-sided material into two)
  const seedP = n(attribute('position', 'vec3'));
  const aux = n(attribute('rainAux', 'vec3'));
  const fall = n(mix(float(R.speed[0]), float(R.speed[1]), aux.z));
  const B = n(u.boxSize), O = n(u.boxMin);
  // the world-anchored drop pattern (period = the box), moved by the fall and the integrated wind, wrapped into the box
  const raw = n(vec3(n(seedP.x).mul(B.x).add(n(u.windOff).x), n(seedP.y).mul(B.y).sub(fall.mul(u.t)), n(seedP.z).mul(B.z).add(n(u.windOff).y)));
  const head = n(vec3(wrap(raw.x, O.x, B.x), wrap(raw.y, O.y, B.y), wrap(raw.z, O.z, B.z))).toVar('rainHead');
  const vel = n(vec3(n(u.wind).x, fall.negate(), n(u.wind).y));
  const dir = n(normalize(vel)).toVar('rainDir');
  // the shelter: the rain floor at the head's x / z (nearest texel; clamped)
  const fx = n(clamp(floor(n(head.x).sub(m.x0).div(m.cell)), 0, m.w - 1)), fz = n(clamp(floor(n(head.z).sub(m.z0).div(m.cell)), 0, m.h - 1));
  const floorY = n(texture(floorTex).load(ivec2(int(fx), int(fz)))).r;
  const above = n(head.y).greaterThan(floorY);
  // clip disc (the aperture column) and the depth fade into the pit
  const dd = n(length(n(head).xz.sub(n(u.disc).xy)));
  const inDisc = n(u.disc).w.lessThan(0.5).or(dd.lessThan(n(u.disc).z));
  const depthK = n(float(1).sub(smoothstep(0, max(n(u.fade).y, 1e-3), n(u.fade).x.sub(head.y)).mul(n(u.fade).y.greaterThan(0).select(float(1), float(0)))));
  // eye-relative: distance fades and the >= 1 px width
  const toEye = n(head).sub(cameraPosition);
  const dist = n(length(toEye)).toVar('rainDist');
  const hd = n(length(n(toEye).xz));
  const reachK = n(n(u.reach).greaterThan(0).select(float(1).sub(smoothstep(n(u.reach).mul(0.62), n(u.reach), hd)), float(1)));
  const nearK = n(smoothstep(0.35, 1.3, dist));
  const w = n(max(float(R.width), dist.mul(u.px).mul(R.pxK))).toVar('rainW');
  const vis = n(above.and(inDisc).select(float(1), float(0))).mul(depthK).mul(reachK).mul(nearK).mul(u.on).toVar('rainVis');
  const len = n(fall.mul(R.streakS));
  const side = n(normalize(cross(dir, normalize(toEye).add(vec3(0, 1e-4, 0)))));
  // a hidden drop collapses to a zero-area quad at its head (no fragments)
  const live = n(vis.greaterThan(0.002).select(float(1), float(0)));
  mat.positionNode = n(head).sub(n(dir).mul(len.mul(aux.y).mul(live))).add(n(side).mul(n(aux.x).mul(w).mul(0.5).mul(live)));
  // the streak's look: tapered ends, soft sides, energy kept when widened; lit blue near the beam
  const vEnd = n(varying(aux.y, 'vRainEnd')), vSide = n(varying(aux.x, 'vRainSide'));
  const vA = n(varying(vis.mul(min(float(1), float(R.width).div(w))), 'vRainA'));
  const bd = n(length(n(head).xz.sub(n(u.beam).xy)));
  const vBeam = n(varying(n(u.beam).z.mul(float(1).div(float(1).add(bd.div(R.beamR).mul(bd.div(R.beamR))))), 'vRainBeam'));
  mat.colorNode = Fn(() => {
    const c = n(vec3(R.colour[0], R.colour[1], R.colour[2])).add(n(vec3(0.32, 0.6, 1)).mul(vBeam).mul(R.beamGain));
    return vec4(c, 1);
  })();
  const taper = n(smoothstep(0, 0.25, vEnd)).mul(float(1).sub(smoothstep(0.55, 1, vEnd)).mul(0.75).add(0.25));
  mat.opacityNode = n(vA).mul(taper).mul(float(1).sub(abs(vSide).mul(abs(vSide)))).mul(R.alpha);
  return mat;
}

export interface RainLayerStats { drops: number; triangles: number; visible: boolean }

/** One rain layer: a single mesh (one draw) of `count` drops. */
export class RainLayer {
  readonly u = rainUniforms();
  readonly mesh: THREE.Mesh;
  private windAcc = new THREE.Vector2();
  private clock = 0;

  constructor(readonly name: string, readonly count: number, floorTex: THREE.DataTexture, floorMap: RainFloorMap, seed: number) {
    this.mesh = new THREE.Mesh(rainGeometry(count, seed), rainMaterial(this.u, floorTex, floorMap));
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 4; // after the city / the outdoor sky (transparent pass)
    this.mesh.visible = false;
  }

  /** Advance the clock / wind (s). */
  tick(dt: number, gustT: number): void {
    const R = SURFACE_RAIN, g = 1 + R.gust * Math.sin(gustT * 0.37) * Math.sin(gustT * 0.13 + 1.1);
    this.u.wind.value.set(R.wind[0] * g, R.wind[1] * g);
    this.windAcc.addScaledVector(this.u.wind.value, dt);
    const B = this.u.boxSize.value;
    this.windAcc.set(this.windAcc.x % Math.max(1, B.x), this.windAcc.y % Math.max(1, B.z));
    this.u.windOff.value.copy(this.windAcc);
    this.clock = (this.clock + dt) % R.period;
    this.u.t.value = this.clock;
  }

  /** The near layer's box round the eye. */
  follow(eye: THREE.Vector3): void {
    const N = SURFACE_RAIN.near;
    this.u.boxSize.value.set(N.half * 2, N.below + N.above, N.half * 2);
    this.u.boxMin.value.set(eye.x - N.half, eye.y - N.below, eye.z - N.half);
    this.u.reach.value = N.half;
  }

  /** The aperture column's fixed box (the opening's disc, from above the ground down into the pit). */
  column(site: SurfaceSite): void {
    const C = SURFACE_RAIN.column, o = site.hole;
    this.u.boxSize.value.set(o.r * 2, C.above + C.depth, o.r * 2);
    this.u.boxMin.value.set(o.x - o.r, site.y - C.depth, o.z - o.r);
    this.u.disc.value.set(o.x, o.z, Math.max(0.5, o.r - 0.25), 1);
    this.u.fade.value.set(site.y, C.fade);
    this.u.reach.value = 0;
    // the column's drops never leave this box: an honest bound, so the frustum drops it when the opening is out of view
    const B = this.u.boxSize.value, M = this.u.boxMin.value;
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(M.x + B.x / 2, M.y + B.y / 2, M.z + B.z / 2), Math.hypot(B.x, B.y, B.z) / 2 + 1);
    this.mesh.frustumCulled = true;
  }

  stats(): RainLayerStats {
    return {drops: this.count, triangles: this.count * 2, visible: this.mesh.visible};
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
