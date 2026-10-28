// Iteration 06 (Lane F): GLSL for the volumetric atmosphere (see volumetric.ts for the passes and
// render/atmosphere.ts for the CPU mirror of every formula). GLSL ES 3.00 through three's
// ShaderMaterial prefix (texelFetch / textureSize / sampler3D / sampler2DShadow available). Names are
// vf-prefixed so they never collide with three's prefix (sRGBTransferOETF, cameraPosition, ...).
// Every lookup inside the march loop / branches uses textureLod(..., 0.0) (no implicit derivatives in
// divergent flow control: HLSL/ANGLE would otherwise force-unroll or reject it; none of these textures
// has mipmaps, so the result is identical).

import {FIELD_EMAX, fieldHeaderGLSL, fieldPickGLSL} from '../world/lightField';
import {BILATERAL_K, DENSITY_MAP_RANGE, NOISE_OCTAVE2} from './atmosphere';

/** Marker in every volumetric program (shader-error fallback + tests). */
export const VF_MARK = '// last-line volumetric v1';

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export const VF_VERTEX = /* glsl */ `
${VF_MARK}
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const COMMON = /* glsl */ `
${VF_MARK}
#define VF_PI 3.141592653589793
float vfIGN( vec2 p ) {
	return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}
// three's perspectiveDepthToViewZ, positive distance in front of the camera.
float vfViewZ( float depth, float near, float far ) {
	return - ( near * far ) / ( ( far - near ) * depth - far );
}`;

/**
 * Raymarch at reduced resolution. Output: rgb = in-scattered radiance (scene-linear, same units as
 * surface radiance before tone mapping), a = linear view depth of the surface it stopped at.
 */
export const VF_MARCH = /* glsl */ `
${COMMON}
#ifndef VF_STEPS
	#define VF_STEPS 24
#endif
#define VF_MAP_RANGE ${f(DENSITY_MAP_RANGE)}
#define VF_FIELD_EMAX ${f(FIELD_EMAX)}
uniform sampler2D tDepth;
uniform vec2 uFullSize;
uniform vec2 uLowSize;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform float uMaxDist;
uniform float uFrame;
uniform float uTime;
uniform float uFogDensity;
uniform vec2 uNearFade;
uniform float uDensity;
uniform float uHeightFalloff;
uniform float uRefHeight;
uniform float uNoiseScale;
uniform float uNoiseAmount;
uniform vec3 uWind;
uniform sampler3D tNoise;
uniform highp sampler2DArray tDensityMap;
uniform float uMapSlots;
uniform vec4 uMapXform;
uniform vec2 uMapFloor;
uniform vec3 uPhase;
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform vec2 uFlashCone;
uniform vec3 uFlashColor;
uniform vec2 uFlashRange;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowBias;
uniform float uShadowOn;
uniform highp sampler3D tField;
uniform vec3 uFieldMin;
uniform vec3 uFieldMax;
uniform vec3 uFieldLevels;
uniform float uFieldGain;
uniform vec3 uMuzzlePos;
uniform vec3 uMuzzleColor;
uniform vec2 uMuzzleRange;
varying vec2 vUv;

float vfHG( float c, float g ) {
	float g2 = g * g;
	return ( 1.0 - g2 ) / ( 4.0 * VF_PI * pow( max( 1.0 + g2 - 2.0 * g * c, 1e-4 ), 1.5 ) );
}
// Dual-lobe Henyey-Greenstein: forward lobe uPhase.x, backward lobe uPhase.y, backward weight uPhase.z.
float vfPhase( float c ) {
	return mix( vfHG( c, uPhase.x ), vfHG( c, uPhase.y ), uPhase.z );
}
// three's getDistanceAttenuation.
float vfDistAtt( float d, float cutoff, float decay ) {
	float a = 1.0 / max( pow( max( d, 1e-4 ), decay ), 0.01 );
	if ( cutoff > 0.0 ) {
		float q = d / cutoff;
		q = q * q;
		float w = clamp( 1.0 - q * q, 0.0, 1.0 );
		a *= w * w;
	}
	return a;
}
// sigma_s: per-area multiplier and local floor (density map), height above that floor, drifting noise.
// Level slot holding p (lower crossing / main level / upper deck in one column), from the light field's
// packed band info (one fetch); slot 0 when no field is bound. Shared by the density and field lookups.
int vfSlot( vec3 p ) {
	ivec3 size = textureSize( tField, 0 );
	vec2 uv = ( p.xz - uFieldMin.xz ) / max( uFieldMax.xz - uFieldMin.xz, vec2( 1e-3 ) );
	ivec2 ci = clamp( ivec2( floor( uv * vec2( size.xy ) ) ), ivec2( 0 ), size.xy - ivec2( 1 ) );
	float yr = uFieldMax.y - uFieldMin.y;
	${fieldPickGLSL('tField', 'ci', 'size', 'p.y', 'uFieldMin.y', 'yr')}
	int vfS = 0;
	if ( uFieldGain > 0.0 ) vfS = lfSlot;
	return vfS;
}
float vfDensity( vec3 p, int slot ) {
	vec2 muv = ( p.xz - uMapXform.xy ) * uMapXform.zw;
	vec4 m = textureLod( tDensityMap, vec3( muv, min( float( slot ), uMapSlots - 1.0 ) ), 0.0 );
	float floorY = uMapFloor.x + m.g * uMapFloor.y;
	float hf = clamp( exp( - uHeightFalloff * ( p.y - floorY - uRefHeight ) ), 0.2, 3.0 );
	vec3 q = p * uNoiseScale + uWind * uTime;
	float n = textureLod( tNoise, q, 0.0 ).r * 0.65 + textureLod( tNoise, q * ${f(NOISE_OCTAVE2.scale)} + vec3( ${NOISE_OCTAVE2.offset.map(f).join(', ')} ), 0.0 ).r * 0.35;
	float nf = max( 0.0, 1.0 + uNoiseAmount * ( n * 2.0 - 1.0 ) * 1.6 );
	return uDensity * m.r * VF_MAP_RANGE * hf * nf;
}
// Flashlight shadow map (three's spot shadow matrix + hardware compare). 1 = lit.
float vfShadow( vec3 p ) {
	if ( uShadowOn < 0.5 ) return 1.0;
	vec4 sc = uShadowMatrix * vec4( p, 1.0 );
	if ( sc.w <= 1e-5 ) return 1.0;
	vec3 c = sc.xyz / sc.w;
	if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z < 0.0 || c.z > 1.0 ) return 1.0;
	return textureLod( tShadow, vec3( c.xy, c.z + uShadowBias ), 0.0 );
}
// Baked fixture light field (world/lightField.ts encoding: per-column level slots, see LIGHT_FIELD_PARS)
// at a point in the air: isotropic part, directional colour and direction toward the dominant light.
void vfField( vec3 p, vec3 dims, int lfSlot, out vec3 amb, out vec3 dcol, out vec3 ldir ) {
	ivec3 size = ivec3( dims );
	vec2 uv = ( p.xz - uFieldMin.xz ) / max( uFieldMax.xz - uFieldMin.xz, vec2( 1e-3 ) );
	ivec2 ci = clamp( ivec2( floor( uv * dims.xy ) ), ivec2( 0 ), size.xy - ivec2( 1 ) );
	float yr = uFieldMax.y - uFieldMin.y;
	${fieldHeaderGLSL('tField', 'ci', 'uFieldMin.y', 'yr')}
	vec4 hc = textureLod( tField, vec3( uv, ( lfBase + 0.5 ) / dims.z ), 0.0 );
	float rel = clamp( ( p.y - lfFl ) / max( lfCe - lfFl, 0.3 ), 0.0, 1.0 ) * lfTop;
	float k0 = floor( rel );
	float k1 = min( k0 + 1.0, lfTop );
	float wk = rel - k0;
	vec4 a0 = textureLod( tField, vec3( uv, ( lfBase + 1.5 + 2.0 * k0 ) / dims.z ), 0.0 );
	vec4 a1 = textureLod( tField, vec3( uv, ( lfBase + 1.5 + 2.0 * k1 ) / dims.z ), 0.0 );
	vec4 b = textureLod( tField, vec3( uv, ( lfBase + 2.5 + 2.0 * ( wk < 0.5 ? k0 : k1 ) ) / dims.z ), 0.0 );
	vec3 T = mix( a0.rgb * a0.rgb, a1.rgb * a1.rgb, wk ) * VF_FIELD_EMAX;
	float rho = mix( a0.a, a1.a, wk );
	float m = max( 0.0, 1.0 - hc.b * ( 1.0 - uFieldLevels.x ) - hc.a * ( 1.0 - uFieldLevels.y ) - b.a * ( 1.0 - uFieldLevels.z ) );
	vec3 d = b.rgb * 2.0 - 1.0;
	float dl = length( d );
	ldir = dl > 1e-4 ? d / dl : vec3( 0.0, 1.0, 0.0 );
	amb = T * ( 1.0 - rho ) * m;
	dcol = T * rho * m;
}

void main() {
	ivec2 lo = ivec2( gl_FragCoord.xy );
	// Depth of this low-res pixel: checkerboard of the nearest / farthest of its full-res block corners
	// (the depth-aware upsample then finds a matching low-res neighbour on both sides of an edge).
	vec2 ratio = uFullSize / uLowSize;
	ivec2 fmax = ivec2( uFullSize ) - 1;
	ivec2 b0 = clamp( ivec2( floor( vec2( lo ) * ratio ) ), ivec2( 0 ), fmax );
	ivec2 b1 = clamp( ivec2( floor( ( vec2( lo ) + 1.0 ) * ratio ) ) - 1, b0, fmax );
	float d00 = texelFetch( tDepth, b0, 0 ).r;
	float d10 = texelFetch( tDepth, ivec2( b1.x, b0.y ), 0 ).r;
	float d01 = texelFetch( tDepth, ivec2( b0.x, b1.y ), 0 ).r;
	float d11 = texelFetch( tDepth, b1, 0 ).r;
	float dmin = min( min( d00, d10 ), min( d01, d11 ) );
	float dmax = max( max( d00, d10 ), max( d01, d11 ) );
	float depth = ( ( lo.x + lo.y ) & 1 ) == 0 ? dmin : dmax;

	vec2 ndc = ( vec2( lo ) + 0.5 ) / uLowSize * 2.0 - 1.0;
	vec4 vf = uProjInv * vec4( ndc, 1.0, 1.0 );
	vec3 vdir = normalize( vf.xyz / vf.w );
	float viewZ = depth >= 1.0 ? uFar : vfViewZ( depth, uNear, uFar );
	// Never march past the visible surface: nothing behind a wall / prop / zombie contributes.
	float sceneDist = viewZ / max( - vdir.z, 1e-4 );
	float dist = min( sceneDist, uMaxDist );
	vec3 dir = normalize( ( uCamWorld * vec4( vdir, 0.0 ) ).xyz );
	float jit = vfIGN( gl_FragCoord.xy + 5.588238 * mod( uFrame, 64.0 ) );
	bool flashOn = uFlashColor.r + uFlashColor.g + uFlashColor.b > 0.0;
	bool muzzleOn = uMuzzleColor.r + uMuzzleColor.g + uMuzzleColor.b > 0.0;
	vec3 fieldDims = vec3( textureSize( tField, 0 ) );

	vec3 acc = vec3( 0.0 );
	for ( int i = 0; i < VF_STEPS; i ++ ) {
		float u = ( float( i ) + jit ) / float( VF_STEPS );
		float t = dist * u * u;
		float w = 2.0 * dist * u / float( VF_STEPS );
		vec3 p = uCamPos + dir * t;
		int slot = vfSlot( p );
		float sigma = vfDensity( p, slot );
		if ( sigma <= 0.0 ) continue;
		vec3 L = vec3( 0.0 );
		if ( flashOn ) {
			vec3 lv = p - uFlashPos;
			float ld = max( length( lv ), 1e-4 );
			vec3 l = lv / ld;
			float spot = smoothstep( uFlashCone.x, uFlashCone.y, dot( l, uFlashDir ) );
			if ( spot > 0.0 ) {
				float nf = smoothstep( uNearFade.x, uNearFade.y, t );
				L += uFlashColor * ( spot * nf * vfDistAtt( ld, uFlashRange.x, uFlashRange.y ) * vfShadow( p ) * vfPhase( dot( l, - dir ) ) );
			}
		}
		if ( uFieldGain > 0.0 ) {
			vec3 amb;
			vec3 dcol;
			vec3 ldir;
			vfField( p, fieldDims, slot, amb, dcol, ldir );
			L += uFieldGain * ( amb * ( 1.0 / VF_PI ) + dcol * vfPhase( dot( ldir, dir ) ) );
		}
		if ( muzzleOn ) {
			vec3 mv = p - uMuzzlePos;
			float md = max( length( mv ), 1e-4 );
			L += uMuzzleColor * ( vfDistAtt( max( md, 0.5 ), uMuzzleRange.x, uMuzzleRange.y ) * vfPhase( dot( mv / md, - dir ) ) );
		}
		float tr = uFogDensity * t;
		acc += L * ( sigma * w * exp( - tr * tr ) );
	}
	gl_FragColor = vec4( acc, viewZ );
}`;

/**
 * Temporal accumulation at march resolution: reproject each pixel's surface point into last frame,
 * clamp the history to the current 3x3 neighbourhood (no ghost trails when the camera-held beam
 * sweeps), reject on depth mismatch (disocclusion), blend.
 */
export const VF_TEMPORAL = /* glsl */ `
${COMMON}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform vec2 uLowSize;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform mat4 uPrevViewProj;
uniform float uHistoryValid;
uniform float uBlend;
varying vec2 vUv;
void main() {
	ivec2 px = ivec2( gl_FragCoord.xy );
	ivec2 hi = ivec2( uLowSize ) - 1;
	vec4 cur = texelFetch( tCurrent, px, 0 );
	vec3 mn = cur.rgb;
	vec3 mx = cur.rgb;
	for ( int j = -1; j <= 1; j ++ ) {
		for ( int i = -1; i <= 1; i ++ ) {
			vec3 c = texelFetch( tCurrent, clamp( px + ivec2( i, j ), ivec2( 0 ), hi ), 0 ).rgb;
			mn = min( mn, c );
			mx = max( mx, c );
		}
	}
	vec3 outc = cur.rgb;
	if ( uHistoryValid > 0.5 ) {
		vec2 ndc = ( vec2( px ) + 0.5 ) / uLowSize * 2.0 - 1.0;
		vec4 vf = uProjInv * vec4( ndc, 1.0, 1.0 );
		vec3 vdir = vf.xyz / vf.w;
		vec3 vpos = vdir * ( cur.a / max( - vdir.z, 1e-4 ) );
		vec4 wpos = uCamWorld * vec4( vpos, 1.0 );
		vec4 pc = uPrevViewProj * wpos;
		if ( pc.w > 1e-4 ) {
			vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
			if ( puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0 ) {
				vec4 h = textureLod( tHistory, puv, 0.0 );
				float rel = abs( h.a - pc.w ) / max( pc.w, 0.1 );
				float k = uBlend * ( 1.0 - smoothstep( 0.04, 0.12, rel ) );
				outc = mix( cur.rgb, clamp( h.rgb, mn, mx ), k );
			}
		}
	}
	gl_FragColor = vec4( outc, cur.a );
}`;

/**
 * Full-resolution composite onto the canvas: depth-aware (bilateral) upsample of the in-scatter, then
 * added in scene-linear space by inverting three's ACES + sRGB output of the scene pixel, adding, and
 * re-applying them. Pixels without in-scatter are copied unchanged (exact r5 output).
 */
export const VF_COMPOSITE = /* glsl */ `
${COMMON}
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tFog;
uniform vec2 uFullSize;
uniform vec2 uLowSize;
uniform float uNear;
uniform float uFar;
uniform float uExposure;
uniform float uIntensity;
uniform mat3 uAcesIn;
uniform mat3 uAcesOut;
uniform mat3 uAcesInInv;
uniform mat3 uAcesOutInv;
varying vec2 vUv;
vec3 vfRRT( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
float vfRRTInv1( float y ) {
	float yy = clamp( y, 0.0, 0.99 );
	float A = yy * 0.983729 - 1.0;
	float B = yy * 0.4329510 - 0.0245786;
	float C = yy * 0.238081 + 0.000090537;
	return ( - B - sqrt( max( 0.0, B * B - 4.0 * A * C ) ) ) / ( 2.0 * A );
}
vec3 vfAces( vec3 c ) {
	vec3 v = uAcesIn * ( c * ( uExposure / 0.6 ) );
	return clamp( uAcesOut * vfRRT( v ), 0.0, 1.0 );
}
vec3 vfAcesInv( vec3 d ) {
	vec3 u = uAcesOutInv * d;
	vec3 v = uAcesInInv * vec3( vfRRTInv1( u.r ), vfRRTInv1( u.g ), vfRRTInv1( u.b ) );
	return max( v * ( 0.6 / uExposure ), vec3( 0.0 ) );
}
vec3 vfSrgbDecode( vec3 c ) {
	return mix( pow( c * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), c * 0.0773993808, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
}
vec3 vfSrgbEncode( vec3 c ) {
	return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
void main() {
	ivec2 px = ivec2( gl_FragCoord.xy );
	vec4 sc = texelFetch( tScene, px, 0 );
	float d = texelFetch( tDepth, px, 0 ).r;
	float z = d >= 1.0 ? uFar : vfViewZ( d, uNear, uFar );
	// Bilateral upsample: bilinear weights x depth similarity; nearest-depth fallback at hard edges.
	vec2 lp = ( vec2( px ) + 0.5 ) * ( uLowSize / uFullSize ) - 0.5;
	ivec2 lb = ivec2( floor( lp ) );
	vec2 fr = lp - vec2( lb );
	ivec2 lhi = ivec2( uLowSize ) - 1;
	vec3 acc = vec3( 0.0 );
	float wsum = 0.0;
	vec3 best = vec3( 0.0 );
	float bestDz = 1e9;
	for ( int j = 0; j < 2; j ++ ) {
		for ( int i = 0; i < 2; i ++ ) {
			vec4 s = texelFetch( tFog, clamp( lb + ivec2( i, j ), ivec2( 0 ), lhi ), 0 );
			float wb = ( i == 0 ? 1.0 - fr.x : fr.x ) * ( j == 0 ? 1.0 - fr.y : fr.y );
			float dz = abs( s.a - z ) / max( z, 0.05 );
			float w = max( wb, 1e-3 ) * exp( - dz * ${f(BILATERAL_K)} );
			acc += s.rgb * w;
			wsum += w;
			if ( dz < bestDz ) {
				bestDz = dz;
				best = s.rgb;
			}
		}
	}
	vec3 fog = ( wsum > 1e-4 ? acc / wsum : best ) * uIntensity;
	if ( max( fog.r, max( fog.g, fog.b ) ) <= 1e-6 ) {
		gl_FragColor = vec4( sc.rgb, 1.0 );
		return;
	}
	vec3 hdr = vfAcesInv( vfSrgbDecode( sc.rgb ) );
	// Never darker than the scene pixel (the inverse clamps saturated highlights); dither against banding.
	vec3 outc = max( vfSrgbEncode( vfAces( hdr + fog ) ), sc.rgb );
	outc += ( vfIGN( gl_FragCoord.xy ) - 0.5 ) / 255.0;
	gl_FragColor = vec4( outc, 1.0 );
}`;
