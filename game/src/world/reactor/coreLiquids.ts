// Task reactor-expansion-20261101 (lane CORE): the reactor's DYNAMIC layer (code-driven, allowed: CLAUDE.md "dynamic textures are exempt") —
//  - THE GOOP: one mesh over the pool cells at the goop surface; an unlit TSL material: slow interfering flow waves, radial ripples off
//    the vessel, popping bubbles, brighter at the edges (a per-vertex distance to the deck edge), strength / churn from the stage;
//  - THE BLUE COOLANT FLOW: open sleeves round every coolant run (coreHero.ts flows) whose two slots along the pipe stream bright
//    dashes in the flow direction (a per-vertex metres-along attribute), dark until the pump runs (a faint fill once pressurised);
//  - SIGHT GLASSES on the cold-leg risers: they fill from the bottom when the valve opens, streak once the pump runs;
//  - the pumps' flywheels / the turbine coupling (one InstancedMesh, the kit's 'blade' rotor), the status lamps (one InstancedMesh,
//    instance colours set only when a stage level changes).
// Bounded: 5 meshes, a few thousand triangles; per frame only uniforms + the turning rotors' matrices.
// Task reactor-playtest-round2-20261102 (lane COOLANT): this flow / glass look is the FAR LOD now; the near goop layer (coolantNear.ts,
// its own group) takes over close to the eye through a shared per-pixel dither fade (farKeep), so each pixel draws one of the two.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {abs, attribute, clamp, dot, float, floor, fract, length, mix, positionWorld, sin, smoothstep, uniform, uv, vec2, vec3} from 'three/tsl';
import {CELL, FLOOR, type Grid} from '../../gen/grid';
import {glowFog} from '../lights';
import {kitGeometry} from './archMeshes';
import type {CoreHeroLayout} from './coreHero';
import {buildCoolantNear, createNearFade, farKeep, type CoolantNear, type NearFade} from './coolantNear'; // (lane COOLANT)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** The uniforms the visuals drive (stage look + time). */
export interface CoreUniforms {
  time: {value: number};
  goop: {value: number};
  churn: {value: number};
  flowGlow: {value: number};
  flowShift: {value: number};
  fill: {value: number};
}

export interface CoreBuilt {
  group: THREE.Group;
  uniforms: CoreUniforms;
  goop: THREE.Mesh | null;
  flow: THREE.Mesh | null;
  glass: THREE.Mesh | null;
  wheels: THREE.InstancedMesh | null;
  /** Rotor bases (local Z = the axis), radius, kind. */
  wheelInfo: {basis: THREE.Matrix4; r: number; kind: 'rcp' | 'turbine'; angle: number}[];
  lamps: THREE.InstancedMesh | null;
  /** Task reactor-playtest-round2-20261102 (lane COOLANT): the near goop LOD (its own group: the caller adds it beside `group`). */
  near: CoolantNear | null;
  geometries: THREE.BufferGeometry[];
  stats: {goopCells: number; flowSegments: number; glasses: number; windows: number; wheels: number; lamps: number; triangles: number};
}

/** Goop colours (linear): deep / bright. */
const GOOP_DEEP = new THREE.Color(0.02, 0.32, 0.06), GOOP_BRIGHT = new THREE.Color(0.42, 1.0, 0.22);
const COOLANT = new THREE.Color(0.18, 0.62, 1.6);

/** Builds the dynamic layer into a group (caller adds it to the world group). `core` = the core floor grid (the pool cells). */
export function buildCoreLiquids(hero: CoreHeroLayout, core: Grid | null, rotorMat: THREE.Material, levels: readonly number[]): CoreBuilt {
  const group = new THREE.Group();
  group.name = 'core-dynamic'; // (not 'reactor-…': ARCH's kit mesh count stays its own)
  const uniforms: CoreUniforms = {time: uniform(0), goop: uniform(0.55), churn: uniform(0.25), flowGlow: uniform(0), flowShift: uniform(0), fill: uniform(0)} as unknown as CoreUniforms;
  const geos: THREE.BufferGeometry[] = [];
  const stats = {goopCells: 0, flowSegments: 0, glasses: 0, windows: 0, wheels: 0, lamps: 0, triangles: 0};
  const tag = (o: THREE.Object3D) => { o.userData.levels = [...levels]; o.matrixAutoUpdate = false; o.updateMatrix(); group.add(o); };
  // ---- the goop -------------------------------------------------------------------------------------------------------------------
  let goop: THREE.Mesh | null = null;
  if (core) {
    const g = goopGeometry(hero, core);
    if (g) {
      geos.push(g);
      stats.goopCells = g.userData.cells as number;
      goop = new THREE.Mesh(g, goopMaterial(uniforms, hero.cf.x, hero.cf.z));
      goop.name = 'core-goop';
      tag(goop);
    }
  }
  // ---- the coolant flow sleeves + sight glasses --------------------------------------------------------------------------------------
  let flow: THREE.Mesh | null = null, glass: THREE.Mesh | null = null;
  const fade = createNearFade(); // (lane COOLANT) r1 = 0 until the near layer is active: the far look everywhere
  {
    const sl = new SleeveBuilder();
    for (const f of hero.flows) {
      let s = 0;
      const k = f.kind === 'feed' ? 0.6 : f.kind === 'hot' ? 0.9 : 1;
      if (f.segs) { // the straight pieces actually drawn (cut at the elbow / spool models: the coolant runs on inside them)
        for (const q of f.segs) { const L = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y, q.b.z - q.a.z); if (L < 0.05) continue; sl.tube(q.a, q.b, f.d / 2 + 0.014, q.s0, q.s0 + L, k); stats.flowSegments++; }
        continue;
      }
      for (let i = 0; i + 1 < f.pts.length; i++) {
        const a = f.pts[i], b = f.pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (L < 0.05) continue;
        sl.tube(a, b, f.d / 2 + 0.014, s, s + L, k);
        s += L;
        stats.flowSegments++;
      }
    }
    const fg = sl.geometry();
    if (fg) { geos.push(fg); flow = new THREE.Mesh(fg, flowMaterial(uniforms, fade)); flow.name = 'core-coolant-flow'; tag(flow); }
    const gl = new SleeveBuilder();
    for (const q of hero.glasses) { gl.tube(q.a, q.b, q.d / 2 + 0.035, 0, Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y, q.b.z - q.a.z), 1); stats.glasses++; }
    for (const w of hero.windows ?? []) { gl.quad(w.m); stats.windows++; } // the sight-glass spools' windows: the coolant glows behind the glass
    const gg = gl.geometry();
    if (gg) { geos.push(gg); glass = new THREE.Mesh(gg, glassMaterial(uniforms, fade)); glass.name = 'core-sight-glasses'; tag(glass); }
  }
  // ---- rotors ---------------------------------------------------------------------------------------------------------------------
  let wheels: THREE.InstancedMesh | null = null;
  const wheelInfo: CoreBuilt['wheelInfo'] = [];
  if (hero.wheels.length) {
    const blade = kitGeometry('blade');
    geos.push(blade);
    wheels = new THREE.InstancedMesh(blade, rotorMat, hero.wheels.length);
    wheels.name = 'core-rotors';
    const z = new THREE.Vector3(), x = new THREE.Vector3(), y = new THREE.Vector3(), m = new THREE.Matrix4(), s = new THREE.Vector3();
    hero.wheels.forEach((w, i) => {
      z.set(w.ax, w.ay, w.az).normalize();
      x.set(Math.abs(z.y) > 0.9 ? 1 : 0, Math.abs(z.y) > 0.9 ? 0 : 1, 0);
      y.crossVectors(z, x).normalize(); x.crossVectors(y, z).normalize();
      const basis = new THREE.Matrix4().makeBasis(x.clone(), y.clone(), z.clone()).setPosition(w.x, w.y, w.z);
      wheelInfo.push({basis, r: w.r, kind: w.kind, angle: i * 0.9});
      wheels!.setMatrixAt(i, m.copy(basis).multiply(new THREE.Matrix4().makeRotationZ(i * 0.9)).scale(s.setScalar(w.r)));
    });
    wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wheels.frustumCulled = false;
    wheels.computeBoundingSphere();
    tag(wheels);
    stats.wheels = hero.wheels.length;
  }
  // ---- status lamps -----------------------------------------------------------------------------------------------------------------
  let lamps: THREE.InstancedMesh | null = null;
  if (hero.lamps.length) {
    const bulb = kitGeometry('bulb');
    geos.push(bulb);
    const mat = new MeshBasicNodeMaterial({color: 0xffffff});
    mat.name = 'reactor-status-lamps';
    lamps = new THREE.InstancedMesh(bulb, mat, hero.lamps.length);
    lamps.name = 'core-status-lamps';
    const m = new THREE.Matrix4(), c = new THREE.Color(0.03, 0.03, 0.03);
    hero.lamps.forEach((l, i) => { lamps!.setMatrixAt(i, m.makeScale(l.r * 2, l.r * 2, l.r * 2).setPosition(l.x, l.y, l.z)); lamps!.setColorAt(i, c); });
    lamps.computeBoundingSphere();
    lamps.userData.levels = undefined;
    lamps.matrixAutoUpdate = false;
    group.add(lamps); // site lamps sit on other storeys: never level-culled (one draw call)
    stats.lamps = hero.lamps.length;
  }
  for (const o of group.children) { const m = o as THREE.Mesh; if (m.isMesh) stats.triangles += ((m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3) * ((m as THREE.InstancedMesh).count ?? 1); }
  // ---- (lane COOLANT) the near goop LOD over the same flow pieces / glasses / windows ------------------------------------------------
  const near = flow || glass ? buildCoolantNear(hero, uniforms, fade, levels) : null;
  if (near) for (const o of near.group.children) geos.push((o as THREE.Mesh).geometry);
  return {group, uniforms, goop, flow, glass, wheels, wheelInfo, lamps, near, geometries: geos, stats};
}

// ---------------------------------------------------------------------------------------------
// The goop surface

/** Quads over the pool cells at the goop surface; per vertex `edge` = metres to the nearest non-pool cell (edge glow). */
export function goopGeometry(hero: CoreHeroLayout, g: Grid): THREE.BufferGeometry | null {
  const cf = hero.cf, W = g.w;
  const fy = cf.pool.floorY, y = cf.pool.surfaceY;
  const pool = new Uint8Array(g.cells.length);
  let cells = 0, x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  const R = cf.pool.r1 + 8;
  const cx0 = Math.max(0, Math.floor((cf.x - R) / CELL)), cx1 = Math.min(g.w - 1, Math.ceil((cf.x + R) / CELL));
  const cy0 = Math.max(0, Math.floor((cf.z - R) / CELL)), cy1 = Math.min(g.h - 1, Math.ceil((cf.z + R) / CELL));
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const i = cy * W + cx;
    if (g.cells[i] !== FLOOR || Math.abs(g.floor[i] - fy) > 1e-3) continue;
    pool[i] = 1; cells++;
    x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
  }
  if (!cells) return null;
  // distance (cells, 4-connected) from each pool cell to the nearest non-pool cell
  const dist = new Int16Array(g.cells.length).fill(-1);
  const q = new Int32Array(cells + 8);
  let h = 0, t = 0;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const i = cy * W + cx;
    if (!pool[i]) continue;
    if (!pool[i - 1] || !pool[i + 1] || !pool[i - W] || !pool[i + W]) { dist[i] = 1; q[t++] = i; }
  }
  while (h < t) {
    const i = q[h++];
    for (const j of [i - 1, i + 1, i - W, i + W]) if (pool[j] && dist[j] < 0) { dist[j] = dist[i] + 1; q[t++] = j; }
  }
  // corner vertices
  const vIndex = new Map<number, number>();
  const pos: number[] = [], edge: number[] = [], idx: number[] = [];
  const cw = W + 1;
  const vert = (vx: number, vy: number): number => {
    const key = vy * cw + vx;
    let v = vIndex.get(key);
    if (v !== undefined) return v;
    // the corner's distance: the smallest of its pool cells' (a non-pool neighbour cell = the edge itself)
    let d = 99;
    for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const ci = (vy + oy) * W + vx + ox;
      d = Math.min(d, pool[ci] ? dist[ci] - 0.5 : 0);
    }
    v = pos.length / 3;
    pos.push(vx * CELL, y, vy * CELL);
    edge.push(Math.max(0, d) * CELL);
    vIndex.set(key, v);
    return v;
  };
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (!pool[cy * W + cx]) continue;
    const a = vert(cx, cy), b = vert(cx + 1, cy), c = vert(cx + 1, cy + 1), d = vert(cx, cy + 1);
    idx.push(a, d, c, a, c, b); // facing +y
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.userData.cells = cells;
  return geo;
}

/** The goop: unlit, fogged gently (it is a light source: it reads through the haze like the lamp tubes). */
function goopMaterial(u: CoreUniforms, cx: number, cz: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'reactor-goop';
  const p = n(positionWorld).xz.toVar();
  const t = n(u.time).mul(u.churn).toVar();
  const w1 = sin(n(p).x.mul(0.55).add(n(t).mul(0.7))).mul(sin(n(p).y.mul(0.47).sub(n(t).mul(0.5))));
  const w2 = sin(n(p).x.add(n(p).y).mul(1.3).sub(n(t).mul(1.6))).mul(0.5);
  const rr = length(n(p).sub(vec2(cx, cz)));
  const w3 = sin(n(rr).mul(2.2).sub(n(t).mul(1.1))).mul(0.35);
  const base = clamp(n(float(0.55)).add(n(w1).add(w2).add(w3).mul(0.22)), 0, 1).toVar();
  // bubbles: one per 0.6 m cell, each popping on its own cycle (bright then gone)
  const cell = floor(n(p).mul(1.6));
  const hsh = fract(sin(dot(n(cell), vec2(12.9898, 78.233))).mul(43758.5453));
  const ph = fract(n(t).mul(n(float(0.35)).add(n(hsh).mul(0.5))).add(hsh));
  const spot = smoothstep(0.3, 0.05, length(fract(n(p).mul(1.6)).sub(0.5)));
  const bubble = n(spot).mul(smoothstep(0.75, 0.95, ph)).mul(smoothstep(0.55, 0.85, hsh)).mul(1.4);
  const edgeK = n(float(1)).add(n(float(1)).sub(smoothstep(0, 1.4, n(attribute('edge', 'float')))).mul(0.9));
  const col = mix(vec3(GOOP_DEEP.r, GOOP_DEEP.g, GOOP_DEEP.b), vec3(GOOP_BRIGHT.r, GOOP_BRIGHT.g, GOOP_BRIGHT.b), n(base).add(bubble));
  m.colorNode = n(col).mul(edgeK).mul(u.goop);
  glowFog(m, 0.45);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Coolant sleeves (open tubes: uv.x round, `flowS` metres along the run, `flowK` brightness)

class SleeveBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uvs: number[] = [];
  private s: number[] = [];
  private k: number[] = [];
  private idx: number[] = [];
  private readonly seg = 10;
  tube(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}, r: number, s0: number, s1: number, k: number): void {
    const ax = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    const ref = Math.abs(ax.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const e1 = new THREE.Vector3().crossVectors(ax, ref).normalize(), e2 = new THREE.Vector3().crossVectors(ax, e1).normalize();
    const base = this.pos.length / 3;
    for (let j = 0; j <= this.seg; j++) {
      const th = (j / this.seg) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const nx = e1.x * c + e2.x * sn, ny = e1.y * c + e2.y * sn, nz = e1.z * c + e2.z * sn;
      for (const [P, sv, v] of [[a, s0, 0], [b, s1, 1]] as const) {
        this.pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
        this.nor.push(nx, ny, nz);
        this.uvs.push(j / this.seg, v);
        this.s.push(sv);
        this.k.push(k);
      }
    }
    for (let j = 0; j < this.seg; j++) {
      const p = base + j * 2;
      this.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
  }
  /** A flat window quad (matrix: centre, X = width, Y = height, Z = normal) 6 mm proud of its face; uv.y rises with the fill. */
  quad(m: THREE.Matrix4): void {
    const base = this.pos.length / 3, nrm = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize(), v = new THREE.Vector3();
    for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) {
      v.set(x, y, 0).applyMatrix4(m).addScaledVector(nrm, 0.006);
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(nrm.x, nrm.y, nrm.z);
      this.uvs.push(x + 0.5, y + 0.5);
      this.s.push(0);
      this.k.push(1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('flowS', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('flowK', new THREE.Float32BufferAttribute(this.k, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Two glowing slots along each coolant pipe streaming dashes downstream; cut out elsewhere (the pipe shows). The FAR look: dithered
 *  out where the near goop layer draws (lane COOLANT `farKeep`). */
function flowMaterial(u: CoreUniforms, fade: NearFade): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'reactor-coolant-flow';
  const around = fract(n(uv()).x.mul(2));
  const slot = n(smoothstep(0.0, 0.03, around)).mul(n(float(1)).sub(smoothstep(0.13, 0.16, around)));
  const s = n(attribute('flowS', 'float')).mul(0.55).sub(u.flowShift);
  const ph = fract(s);
  const dash = n(smoothstep(0.0, 0.18, ph)).mul(n(float(1)).sub(smoothstep(0.45, 0.8, ph)));
  const k = n(attribute('flowK', 'float'));
  const glow = n(u.flowGlow).mul(n(float(0.3)).add(n(dash).mul(0.9))).mul(k);
  m.colorNode = n(vec3(COOLANT.r, COOLANT.g, COOLANT.b)).mul(glow).add(vec3(0.004, 0.012, 0.02));
  m.opacityNode = n(slot).mul(farKeep(fade));
  m.alphaTest = 0.5;
  glowFog(m, 0.5);
  return m;
}

/** Sight glasses: dark glass that fills with glowing coolant from the bottom (fill), streaking once it flows. The FAR look (dithered out
 *  where the near layer draws). */
function glassMaterial(u: CoreUniforms, fade: NearFade): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'reactor-sight-glass';
  const v = n(uv()).y;
  const full = n(float(1)).sub(smoothstep(n(u.fill).sub(0.04), n(u.fill), v));
  const st = fract(n(v).mul(3).sub(n(u.flowShift).mul(1.6)));
  const streak = abs(n(st).sub(0.5)).mul(2);
  const glow = n(full).mul(n(float(0.35)).add(n(u.flowGlow).mul(n(float(0.7)).add(n(streak).mul(0.6)))));
  m.colorNode = n(vec3(0.03, 0.05, 0.06)).add(n(vec3(COOLANT.r, COOLANT.g, COOLANT.b)).mul(glow));
  m.opacityNode = farKeep(fade);
  m.alphaTest = 0.5;
  glowFog(m, 0.5);
  return m;
}
