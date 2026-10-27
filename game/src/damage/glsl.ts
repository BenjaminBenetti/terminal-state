// Shared GLSL snippets for the iteration-06 damage shaders (craters, prop damage, zombie wounds).
// Names are prefixed `dmg` so they never collide with three's chunks or other lanes' hooks
// (world-mapped textures use wmHash / wmNoise).

/** Value noise (3D) + a bump-mapping normal perturbation from screen-space height derivatives. */
export const DMG_COMMON = /* glsl */ `
#ifndef DMG_COMMON
#define DMG_COMMON
float dmgHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float dmgNoise( vec3 x ) {
	vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( dmgHash( i ), dmgHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( dmgHash( i + vec3( 0, 1, 0 ) ), dmgHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( dmgHash( i + vec3( 0, 0, 1 ) ), dmgHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( dmgHash( i + vec3( 0, 1, 1 ) ), dmgHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
#endif
`;

/** perturbNormalArb (three bumpmap_pars_fragment) under our own name: works without USE_BUMPMAP. */
export const DMG_PERTURB = /* glsl */ `
#ifndef DMG_PERTURB
#define DMG_PERTURB
vec3 dmgPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
	vec3 vSigmaX = normalize( dFdx( surfPos ) );
	vec3 vSigmaY = normalize( dFdy( surfPos ) );
	vec3 R1 = cross( vSigmaY, surfNorm );
	vec3 R2 = cross( surfNorm, vSigmaX );
	float fDet = dot( vSigmaX, R1 ) * faceDir;
	vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
	return normalize( abs( fDet ) * surfNorm - vGrad );
}
#endif
`;

/** Shader anchors the damage hooks insert after (tests assert three still provides them). */
export const DMG_ANCHORS = {
  vertex: ['#include <common>', '#include <begin_vertex>'],
  fragment: ['#include <common>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>', '#include <emissivemap_fragment>'],
} as const;

/** Insert `code` right after `anchor` (first occurrence). Returns the source unchanged if the anchor is missing. */
export function after(src: string, anchor: string, code: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) return src;
  return src.slice(0, i + anchor.length) + '\n' + code + src.slice(i + anchor.length);
}
