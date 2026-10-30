// Task office-props-physics-scale-20261030 (lane RACK): BLINKING STATUS LEDs of the rebuilt server rack (office-server-rack-r2.glb,
// tools/asset-pipeline/props/build-server-rack-r2.mjs). User: "it doesn't really look like servers with blinking lights and all that".
//
// Cheap by design — no light objects, no shadow casters, no per-frame CPU work: the rack's equipment fronts are ONE material
// (`rack-faceplates`) whose glTF emissive texture holds the LED dots, each centred in an 8 x 8 px cell of the 512 x 1024 atlas, with
// a BLINK CLASS in the emissive texture's alpha (255 steady, 170 disk / port activity, 85 slow heartbeat). world/openables.ts swaps
// that material (once per loaded model) for a MeshStandardNodeMaterial whose emissive is a TSL function of the global `time`
// node: each LED gets its own phase / rate from a hash of its atlas cell and the rack's world position (racks never blink in sync).
// Works the same on the WebGPU backend and the WebGL2 fallback (plain TSL arithmetic + one texture read). Everything else of the
// material (albedo atlas, roughness / metalness) is copied as is; without the swap (tests, CPU renders) the LEDs simply glow steady.

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {float, floor, fract, hash, mix, positionWorld, select, smoothstep, step, texture, time, uniform, uv, vec2} from 'three/tsl';

/** Name of the LED-carrying material in the rack GLB. */
export const RACK_LED_MATERIAL = 'rack-faceplates';
/** LED cells per atlas axis (512 x 1024 px / 8 px). */
export const RACK_LED_CELLS = [64, 128] as const;
/** Tuning (uniforms): overall LED brightness (restrained: indicator dots, not lamps). */
export const RACK_LEDS = {gain: uniform(2.2)};

const swapped = new WeakMap<THREE.Material, THREE.Material>();

/**
 * The blinking variant of the rack's faceplate material (cached per source material); any other material comes back unchanged.
 */
export function rackLedMaterial(src: THREE.Material): THREE.Material {
  if (src.name !== RACK_LED_MATERIAL) return src;
  const s = src as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || !s.emissiveMap) return src;
  let m = swapped.get(src);
  if (m) return m;
  const n = new MeshStandardNodeMaterial({
    name: `${RACK_LED_MATERIAL}-blink`, color: s.color, map: s.map, roughness: s.roughness, metalness: s.metalness,
    roughnessMap: s.roughnessMap, metalnessMap: s.metalnessMap, normalMap: s.normalMap, side: s.side,
  });
  n.emissiveNode = rackLedEmissive(s.emissiveMap);
  swapped.set(src, n);
  return n;
}

/** The blinking emissive (linear RGB) of an LED atlas `map`: colour x blink(class, per-LED phase) x gain. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rackLedEmissive(map: THREE.Texture): any {
  const e = texture(map, uv());
  const cell = floor(uv().mul(vec2(RACK_LED_CELLS[0], RACK_LED_CELLS[1])));
  const rack = floor(positionWorld.xz.mul(1.7));
  const seed = hash(cell.x.add(cell.y.mul(131)).add(rack.x.mul(17.3)).add(rack.y.mul(29.1)));
  const seed2 = hash(seed.mul(97).add(3.1));
  // disk / port activity: a 3-8 Hz flicker with idle (dim) stretches
  const flick = step(0.5, fract(time.mul(seed2.mul(5).add(3)).add(seed.mul(7))));
  const busy = step(0.35, fract(time.mul(0.21).add(seed)));
  const activity = mix(float(0.12), float(1), flick).mul(mix(float(0.3), float(1), busy));
  // heartbeat: a short soft pulse every ~2.2 s
  const ph = fract(time.mul(0.45).add(seed));
  const heartbeat = float(0.12).add(smoothstep(0.0, 0.06, ph).mul(float(1).sub(smoothstep(0.1, 0.3, ph))).mul(0.88));
  const steady = float(0.85).add(seed2.mul(0.15));
  const cls = e.a;
  const blink = select(cls.greaterThan(0.8), steady, select(cls.greaterThan(0.5), activity, select(cls.greaterThan(0.2), heartbeat, steady)));
  return e.rgb.mul(blink).mul(RACK_LEDS.gain);
}
