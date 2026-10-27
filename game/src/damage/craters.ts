// Persistent structural chips (iteration 06, Lane D): every bullet into a wall / floor / ceiling /
// ledge face leaves a local crater — a depth-tested instanced decal whose procedural shader draws an
// irregular chipped outline, the exposed substrate (cement under tile glaze, grey block under paint,
// fresh concrete), flaked surface edges in the surface's own colour, a dark bullet core, ambient
// occlusion and a concave bowl normal so the flashlight / baked light field shade it as a hole.
// Repeated hits on the same spot deepen and widen the crater instead of stacking new decals.
//
// Honest scope: big structural surfaces only CHIP (craters + flying chunks). There is no voxel /
// structural destruction: walls, floors and ceilings never open voids or change collision.
// Bounded: one InstancedMesh (1 draw call), CRATER_CAP slots, the oldest recycled when full.

import * as THREE from 'three';
import {addShaderHook} from '../render/shaderHooks';
import {DMG_COMMON} from './glsl';

export const CRATER_CAP = 220;
export const CRATER_HOOK = 'damage-craters-v1';

export interface Crater {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  size: number;
  depth: number;
  maxSize: number;
  hits: number;
  serial: number;
  slot: number;
}

export interface CraterSpec {
  /** Radius of a fresh crater (m) and the cap repeated hits can grow it to. */
  size: number;
  maxSize: number;
  /** Depth added per hit (0..1 of full). */
  depth: number;
  /** Exposed substrate colour and the surface colour of the flaked rim (linear). */
  substrate: THREE.Color;
  surface: THREE.Color;
  /** 0 crater, 1 gravel scatter (ballast: disturbed stones, no bowl), 2 glazed tile (sharp flaked glaze edge). */
  style: 0 | 1 | 2;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aCrater;
attribute vec3 aRim;
varying vec4 vCrater;
varying vec3 vRim;
varying vec2 vCrUv;
varying vec3 vCrT;
varying vec3 vCrB;
`;
const VERT_MAIN = /* glsl */ `
vCrater = aCrater;
vRim = aRim;
vCrUv = uv * 2.0 - 1.0;
vCrT = normalize( ( modelViewMatrix * instanceMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
vCrB = normalize( ( modelViewMatrix * instanceMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
`;
const FRAG_PARS = /* glsl */ `
varying vec4 vCrater;
varying vec3 vRim;
varying vec2 vCrUv;
varying vec3 vCrT;
varying vec3 vCrB;
${DMG_COMMON}
float crR; float crDepth; float crOutline; vec2 crP; float crGrain;
`;
const FRAG_COLOR = /* glsl */ `
{
	crP = vCrUv;
	crDepth = vCrater.x;
	float seed = vCrater.y * 37.0;
	float style = vCrater.z;
	float ang = atan( crP.y, crP.x );
	vec3 ap = vec3( cos( ang ) * 1.6, sin( ang ) * 1.6, seed );
	// irregular chipped outline: low + high frequency around the rim
	float outline = 0.68 + 0.2 * dmgNoise( ap ) + 0.12 * dmgNoise( ap * 3.1 + 7.0 );
	if ( style > 1.5 ) outline = mix( outline, 0.78 + 0.16 * step( 0.5, dmgNoise( ap * 1.7 + 3.0 ) ), 0.6 ); // tile: angular flakes
	crOutline = outline;
	crR = length( crP ) / outline;
	float inside = 1.0 - smoothstep( 0.92, 1.02, crR );
	if ( inside * vCrater.w < 0.004 ) discard;
	crGrain = dmgNoise( vec3( crP * 22.0, seed ) );
	vec3 sub = diffuseColor.rgb;
	vec3 col;
	if ( style > 0.5 && style < 1.5 ) {
		// gravel scatter: darker disturbed stones, no bowl
		col = mix( vRim * 0.55, vRim * 1.1, step( 0.55, crGrain ) );
		diffuseColor.a *= inside * 0.75 * vCrater.w;
	} else {
		float bowl = 1.0 - crR * crR;
		float ao = mix( 1.0, 0.32, clamp( crDepth * bowl * 1.25, 0.0, 1.0 ) );
		col = sub * ao * ( 0.82 + 0.36 * crGrain );
		// flaked edge: the surface finish broken back in an irregular ring (glaze / paint / skim)
		float rim = smoothstep( 0.6, 0.95, crR ) * step( 0.42 - 0.2 * style, dmgNoise( vec3( crP * 9.0, seed + 3.0 ) ) );
		col = mix( col, vRim * ( 0.8 + 0.25 * crGrain ), rim * 0.75 );
		// dark bullet core / deep pit
		float core = 1.0 - smoothstep( 0.06, 0.16 + 0.22 * crDepth, crR );
		col = mix( col, vec3( 0.018, 0.016, 0.014 ), core * ( 0.65 + 0.3 * crDepth ) );
		diffuseColor.a *= inside * vCrater.w;
	}
	diffuseColor.rgb = col;
}
`;
const FRAG_NORMAL = /* glsl */ `
{
	if ( vCrater.z < 0.5 || vCrater.z > 1.5 ) {
		// concave bowl: height h = -depth (1 - r^2) -> slope 2 depth r, plus chip roughness
		float k = 1.6 * crDepth;
		vec2 g = crP * ( 2.0 * k ) / max( 0.25, crOutline * crOutline );
		g += ( vec2( dmgNoise( vec3( crP * 14.0, 1.0 ) ), dmgNoise( vec3( crP * 14.0, 9.0 ) ) ) - 0.5 ) * 0.9 * ( 0.3 + crDepth );
		float inner = 1.0 - smoothstep( 0.85, 1.0, crR );
		vec3 nT = normalize( vec3( - g * inner, 1.0 ) );
		vec3 T = normalize( vCrT - normal * dot( vCrT, normal ) );
		vec3 B = normalize( cross( normal, T ) ) * sign( dot( cross( normal, T ), vCrB ) );
		normal = normalize( T * nT.x + B * nT.y + normal * nT.z );
	}
}
`;

export class CraterField {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Crater[] = [];
  private readonly aCrater: THREE.InstancedBufferAttribute;
  private readonly aRim: THREE.InstancedBufferAttribute;
  private serial = 0;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  /** Hits that deepened an existing crater (QA/tests). */
  merges = 0;

  constructor(readonly cap = CRATER_CAP) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aCrater = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aRim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aCrater.setUsage(THREE.DynamicDrawUsage);
    this.aRim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCrater', this.aCrater);
    geo.setAttribute('aRim', this.aRim);
    const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3});
    mat.name = 'damage-craters';
    addShaderHook(mat, CRATER_HOOK, sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL);
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'damage-craters';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // stays visible at count 0: its program compiles with the station, not on the first hit
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  /**
   * A hit at `pos` on a face with `normal`: deepen / widen a crater already there (same face,
   * overlapping), else start a new one (recycling the oldest when full). Returns the crater.
   */
  hit(pos: THREE.Vector3, normal: THREE.Vector3, spec: CraterSpec, rand: () => number = Math.random): Crater {
    let best: Crater | null = null, bd = Infinity;
    for (const c of this.list) {
      if (c.normal.dot(normal) < 0.95) continue;
      const dx = pos.x - c.pos.x, dy = pos.y - c.pos.y, dz = pos.z - c.pos.z;
      const off = Math.abs(dx * normal.x + dy * normal.y + dz * normal.z);
      if (off > 0.03) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d < c.size * 0.55 + spec.size * 0.35 && d < bd) { bd = d; best = c; }
    }
    if (best) {
      this.merges++;
      best.hits++;
      best.depth = Math.min(1, best.depth + spec.depth * (best.depth > 0.6 ? 0.5 : 1));
      best.size = Math.min(best.maxSize, best.size * 1.1 + spec.size * 0.18);
      best.pos.lerp(pos, 0.12);
      this.write(best, spec, rand, false);
      return best;
    }
    let slot: number;
    if (this.list.length < this.cap) slot = this.list.length;
    else {
      slot = this.next;
      this.next = (this.next + 1) % this.cap;
      const old = this.list.findIndex(c => c.slot === slot);
      if (old >= 0) this.list.splice(old, 1);
    }
    const c: Crater = {pos: pos.clone(), normal: normal.clone(), size: spec.size * (0.85 + rand() * 0.3), depth: Math.min(1, spec.depth * (0.8 + rand() * 0.4)), maxSize: spec.maxSize, hits: 1, serial: ++this.serial, slot};
    this.list.push(c);
    this.write(c, spec, rand, true);
    this.mesh.count = Math.max(this.mesh.count, slot + 1);
    return c;
  }

  private write(c: Crater, spec: CraterSpec, rand: () => number, fresh: boolean): void {
    this.q.setFromUnitVectors(CraterField.Z, c.normal);
    if (fresh) c.serial = c.serial || ++this.serial;
    // stable per-crater rotation from its serial
    this.q2.setFromAxisAngle(CraterField.Z, (c.serial * 2.399963) % (Math.PI * 2));
    this.q.multiply(this.q2);
    const d = c.size * 2;
    this.m.compose(new THREE.Vector3().copy(c.pos).addScaledVector(c.normal, 0.004), this.q, new THREE.Vector3(d, d, 1));
    this.mesh.setMatrixAt(c.slot, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (fresh) {
      this.mesh.setColorAt(c.slot, spec.substrate);
      this.mesh.instanceColor!.needsUpdate = true;
      this.aRim.setXYZ(c.slot, spec.surface.r, spec.surface.g, spec.surface.b);
      this.aRim.needsUpdate = true;
    }
    this.aCrater.setXYZW(c.slot, c.depth, fresh ? rand() : this.aCrater.getY(c.slot), spec.style, 1);
    this.aCrater.needsUpdate = true;
  }

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list.length = 0;
    this.next = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
