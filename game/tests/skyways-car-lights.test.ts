// Task skyways-vehicle-20261107 (lane VIS): the prize car's LAMPS (world/skywaysCarLights.ts + the wiring in world/skywaysCar.ts and
// game.ts): the lens outlines select the body's own painted headlamps (measured on the cooked skyways-prize-car.glb: on the lamp, not the
// paint), the lens material glows through the body's base map only when on; the ONE forward beam is unshadowed, starts in front of the
// bumper and never reaches back into the cockpit, joins the scene only with a car world (in the view group = the warm pool, before the
// warm-up) and leaves it at teardown; F while seated toggles the car's lamps and is consumed (the personal flashlight untouched), F
// outside the car is the flashlight as ever; switching changes intensities only (the scene's light set is constant); the state is the
// car's record v2 `lights` (kept when the player gets out, restored at the next build; an old v1 record = off).
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import sharp from 'sharp';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {CAR_TEXT} from '../src/world/skywaysCar';
import {CAR_LAMPS, createCarBeam, inPoly, lampTriangles, setCarLamps} from '../src/world/skywaysCarLights';
import {buildCarView, carLens, setSkywaysCarModelsForTests} from '../src/world/skywaysCarModel';
import {SKYWAYS_CAR_LANE} from '../src/world/skywaysCarStore';
import {PlayerLight} from '../src/player/flashlight';
import type {WarmupRegistry} from '../src/render/warmup';
import {build, carHost, frame, press, run, teardown, type CarTestHost} from './helpers/skywaysCarHost';
import type {SkywaysCar} from '../src/world/skywaysCar';

const S = CAR_SPEC;
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const doc = await new NodeIO().readBinary(new Uint8Array(readFileSync(here('../public/' + S.url))));
const nodes = doc.getRoot().listNodes();
const bodyPrim = nodes.find(n => n.getName() === 'body')!.getMesh()!.listPrimitives()[0];
const BP = bodyPrim.getAttribute('POSITION')!.getArray() as Float32Array, BN = bodyPrim.getAttribute('NORMAL')!.getArray() as Float32Array;
const BUV = bodyPrim.getAttribute('TEXCOORD_0')!.getArray() as Float32Array, BI = bodyPrim.getIndices()!.getArray() as Uint32Array;
const lamps = lampTriangles(BP, BN, BI);

/** A GLTF-like car (what GLTFLoader builds: `body` + `glass` meshes; the body's material textured). */
function carGltf(): {g: GLTF; map: THREE.Texture} {
  const scene = new THREE.Group(), map = new THREE.Texture();
  for (const n of nodes) {
    const p = n.getMesh()!.listPrimitives()[0], geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.getAttribute('POSITION')!.getArray() as Float32Array, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(p.getAttribute('NORMAL')!.getArray() as Float32Array, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(p.getAttribute('TEXCOORD_0')!.getArray() as Float32Array, 2));
    geo.setIndex(new THREE.BufferAttribute(p.getIndices()!.getArray() as Uint32Array, 1));
    const glass = n.getName() === 'glass';
    const mat = new THREE.MeshStandardMaterial(glass ? {transparent: true, opacity: 0.3} : {map, side: THREE.DoubleSide});
    mat.name = n.getName();
    const m = new THREE.Mesh(geo, mat);
    m.name = n.getName();
    scene.add(m);
  }
  return {g: {scene} as unknown as GLTF, map};
}

const lightsIn = (o: THREE.Object3D) => { const l: THREE.Light[] = []; o.traverse(x => { if ((x as THREE.Light).isLight) l.push(x as THREE.Light); }); return l; };
const beamIn = (o: THREE.Object3D) => lightsIn(o).filter(l => l.name === 'skyways-car-beam');

function enter(h: CarTestHost, car: SkywaysCar): void {
  const b = car.body!, d = carToWorld(b.x, b.z, b.yaw, S.exits.left.x, S.exits.left.z), door = carToWorld(b.x, b.z, b.yaw, -(S.width / 2 - 0.05), S.exits.left.z);
  h.player.place(d.x, d.z, 0, b.y);
  frame(h, car);
  const P = h.player, dx = door.x - P.x, dy = b.y + 0.9 - P.eye, dz = door.z - P.z;
  P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  frame(h, car);
  press(h, car, 'KeyE');
  expect(car.driving).toBe(true);
}
const stopAndExit = (h: CarTestHost, car: SkywaysCar) => { h.keys.held.clear(); run(h, car, 0.3); press(h, car, 'KeyE'); expect(car.driving).toBe(false); };
/** Game.update's gameplay F line (game.ts): the car first, else the personal flashlight. */
const pressF = (car: SkywaysCar, torch: PlayerLight) => { if (!car.onLightKey()) torch.toggle(); };

describe('skyways car lamps: the lenses on the cooked body', () => {
  it('select the painted headlamps: both front corners, on the lamp (not the paint), the LED strip / projector included', async () => {
    const n = lamps.length / 3;
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThan(800);
    let left = 0, right = 0;
    for (let k = 0; k < lamps.length; k += 3) {
      const c = [0, 1, 2].map(j => (BP[3 * lamps[k] + j] + BP[3 * lamps[k + 1] + j] + BP[3 * lamps[k + 2] + j]) / 3);
      expect(c[2]).toBeLessThan(CAR_LAMPS.zMax);
      expect(Math.abs(c[0])).toBeGreaterThan(0.5); expect(Math.abs(c[0])).toBeLessThan(0.9);
      expect(c[1]).toBeGreaterThan(0.63); expect(c[1]).toBeLessThan(0.81);
      if (c[0] < 0) left++; else right++;
    }
    expect(left).toBeGreaterThan(200);
    expect(right).toBeGreaterThan(200);
    // the base map under them (a 6 x 6 barycentric grid per triangle): hardly any paint, a good share of the bright LED strip / projector
    const tex = bodyPrim.getMaterial()!.getBaseColorTexture()!;
    const {data, info} = await sharp(Buffer.from(tex.getImage()!)).removeAlpha().raw().toBuffer({resolveWithObject: true});
    const texel = (u: number, v: number) => { const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width))), y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height))), o = 3 * (y * info.width + x); return [data[o], data[o + 1], data[o + 2]]; };
    let all = 0, paint = 0, bright = 0; // (area-weighted: what shows)
    for (let k = 0; k < lamps.length; k += 3) {
      const [a, b, c] = [lamps[k], lamps[k + 1], lamps[k + 2]];
      const e1 = [0, 1, 2].map(j => BP[3 * b + j] - BP[3 * a + j]), e2 = [0, 1, 2].map(j => BP[3 * c + j] - BP[3 * a + j]);
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      for (let i = 0; i <= 5; i++) for (let j = 0; i + j <= 5; j++) {
        const w0 = (i + 1 / 3) / 6, w1 = (j + 1 / 3) / 6, w2 = 1 - w0 - w1;
        if (w2 < 0) continue;
        const [r, g, bl] = texel(w0 * BUV[2 * a] + w1 * BUV[2 * b] + w2 * BUV[2 * c], w0 * BUV[2 * a + 1] + w1 * BUV[2 * b + 1] + w2 * BUV[2 * c + 1]);
        all += area;
        if (r > 110 && r - g > 60 && r - bl > 50) paint += area;
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        if (mx > 170 && mx - mn < 70) bright += area;
      }
    }
    expect(paint / all).toBeLessThan(0.01); // (measured 0.4 %)
    expect(bright / all).toBeGreaterThan(0.2); // (measured 31 %)
  });

  it('the projector constants sit on the lamp surface (a ray from the front meets the body there)', () => {
    const L = CAR_LAMPS.projector;
    for (const sx of [1, -1]) {
      const x = sx * L.x, y = L.y;
      expect(inPoly(x, y, sx > 0 ? CAR_LAMPS.right : CAR_LAMPS.left)).toBe(true);
      let z = Infinity;
      for (let k = 0; k < BI.length; k += 3) {
        const a = 3 * BI[k], b = 3 * BI[k + 1], c = 3 * BI[k + 2];
        const d = (BP[b + 1] - BP[c + 1]) * (BP[a] - BP[c]) + (BP[c] - BP[b]) * (BP[a + 1] - BP[c + 1]);
        if (Math.abs(d) < 1e-14) continue;
        const w0 = ((BP[b + 1] - BP[c + 1]) * (x - BP[c]) + (BP[c] - BP[b]) * (y - BP[c + 1])) / d, w1 = ((BP[c + 1] - BP[a + 1]) * (x - BP[c]) + (BP[a] - BP[c]) * (y - BP[c + 1])) / d, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        z = Math.min(z, w0 * BP[a + 2] + w1 * BP[b + 2] + w2 * BP[c + 2]);
      }
      expect(Math.abs(z - L.z)).toBeLessThan(0.01);
    }
  });

  it('in the view: the body\'s own lamp triangles over its paint (shared vertices), ONE shared lens material glowing through the base map only when on', () => {
    const {g, map} = carGltf();
    setSkywaysCarModelsForTests({car: g, dash: null, seat: null});
    try {
      const v = buildCarView(S), lens = v.body.getObjectByName('skyways-car-lamp-lens') as THREE.Mesh;
      const body = lens.parent as THREE.Mesh;
      expect(body.name).toBe('body');
      expect(lens.geometry.getAttribute('position')).toBe(body.geometry.getAttribute('position')); // no new bytes
      expect(Array.from(lens.geometry.index!.array)).toEqual(Array.from(lamps));
      const mat = lens.material as THREE.MeshStandardMaterial;
      expect(v.lens).toBe(mat);
      expect(carLens(g)!.material).toBe(mat);
      expect(mat.map).toBe(map);
      expect(mat.emissiveMap).toBe(map);
      expect(mat.emissiveIntensity).toBe(0);
      expect(mat.polygonOffset).toBe(true);
      expect(mat.polygonOffsetFactor).toBeLessThan(0);
      expect(mat.side).toBe(THREE.FrontSide);
      expect(lens.castShadow).toBe(false);
      expect(lens.userData.noShadow).toBe(true);
      // a second view shares the lens geometry + material (one program, one switch)
      const v2 = buildCarView(S);
      expect((v2.body.getObjectByName('skyways-car-lamp-lens') as THREE.Mesh).geometry).toBe(lens.geometry);
      expect(v2.lens).toBe(mat);
      setCarLamps(true, mat, null);
      expect(mat.emissiveIntensity).toBe(CAR_LAMPS.lens.on);
      setCarLamps(false, mat, null);
      expect(mat.emissiveIntensity).toBe(0);
    } finally { setSkywaysCarModelsForTests({car: null, dash: null, seat: null}); }
  });
});

describe('skyways car lamps: the beam', () => {
  it('one unshadowed SpotLight, dark until on, starting in front of the bumper, aimed down the road ahead, never back at the cockpit', () => {
    const b = createCarBeam(), B = CAR_LAMPS.beam, L = b.light;
    expect(L.isSpotLight).toBe(true);
    expect(L.intensity).toBe(0);
    expect(L.castShadow).toBe(false);
    expect(L.target).toBe(b.target);
    expect([L.distance, L.angle, L.penumbra, L.decay]).toEqual([B.distance, B.angle, B.penumbra, B.decay]);
    expect(L.position.z).toBeLessThan(-S.length / 2); // (the body's nose is at -length / 2)
    const axis = b.target.position.clone().sub(L.position).normalize();
    expect(axis.z).toBeLessThan(-0.99); // down the road ahead
    expect(axis.y).toBeLessThan(0); // a little down (the road)
    expect(axis.y).toBeGreaterThan(-0.15);
    const toEye = new THREE.Vector3(S.eye.x, S.eye.y, S.eye.z).sub(L.position).normalize();
    expect(Math.acos(axis.dot(toEye))).toBeGreaterThan(Math.PI / 2); // the cockpit is behind the lamp: far outside its cone
    setCarLamps(true, null, b);
    expect(L.intensity).toBe(B.intensity);
    setCarLamps(false, null, b);
    expect(L.intensity).toBe(0);
  });
});

describe('skyways car lamps: in a world', () => {
  it('the beam joins the scene with the car world (in the warm pool, before any play), dark; no car world, no beam', () => {
    const none = carHost({build: false});
    (none.h as {layout: unknown}).layout = {props: []};
    build(none.h);
    expect(lightsIn(none.h.scene)).toHaveLength(0); // a world without the car: no extra light
    expect(none.car.beam).toBeNull();
    const {h, car} = carHost();
    const beams = beamIn(h.scene);
    expect(beams).toHaveLength(1);
    expect(beams[0]).toBe(car.beam!.light);
    expect(beams[0].parent).toBe(car.view!.group);
    expect(car.beam!.target.parent).toBe(car.view!.group);
    expect((h.warmRegistry as unknown as WarmupRegistry).poolRoots()).toContain(car.view!.group);
    expect(car.lights).toBe(false);
    expect(beams[0].intensity).toBe(0);
    expect(car.view!.lens!.emissiveIntensity).toBe(0); // (the stand-in's lens boxes here: Node has no model)
    expect(car.view!.body.getObjectsByProperty('name', 'skyways-car-lamp-lens')).toHaveLength(0);
    const standLenses: THREE.Object3D[] = [];
    car.view!.body.traverse(o => { if (o.userData.carPart === 'lens') standLenses.push(o); });
    expect(standLenses).toHaveLength(2);
  });

  it('F seated: the car\'s lamps toggle (a click) and the key is consumed — the flashlight untouched; F outside: the flashlight as ever; the light set constant', () => {
    const {h, car} = carHost();
    const clicks: number[] = [];
    (h.sfx as {click?: (p: number) => void}).click = p => { clicks.push(p); };
    const torch = new PlayerLight(new THREE.SpotLight(), 34);
    const set0 = lightsIn(h.scene);
    // outside the car: not consumed, the flashlight toggles, the car's lamps stay off
    const on0 = torch.battery.on, charge0 = torch.battery.charge;
    expect(car.onLightKey()).toBe(false);
    pressF(car, torch);
    expect(torch.battery.on).toBe(!on0);
    expect(car.lights).toBe(false);
    expect(clicks).toEqual([]);
    // seated: consumed; the car's lamps on; the flashlight's state / battery untouched
    enter(h, car);
    const on1 = torch.battery.on;
    pressF(car, torch);
    expect(car.lights).toBe(true);
    expect(torch.battery.on).toBe(on1);
    expect(torch.battery.charge).toBe(charge0);
    expect(car.beam!.light.intensity).toBe(CAR_LAMPS.beam.intensity);
    expect(car.view!.lens!.emissiveIntensity).toBe(CAR_LAMPS.lens.on);
    expect(clicks).toHaveLength(1);
    run(h, car, 0.2);
    expect(car.beam!.light.intensity).toBe(CAR_LAMPS.beam.intensity); // (held by the frame's sync)
    pressF(car, torch);
    expect(car.lights).toBe(false);
    expect(torch.battery.on).toBe(on1);
    expect(car.beam!.light.intensity).toBe(0);
    expect(car.view!.lens!.emissiveIntensity).toBe(0);
    expect(clicks).toHaveLength(2);
    // switching never adds / removes a light
    const set1 = lightsIn(h.scene);
    expect(set1).toHaveLength(set0.length);
    expect(set1.every(l => set0.includes(l))).toBe(true);
    // the controls hint lists it (the in-car hint only)
    expect(car.prompt).toBe(CAR_TEXT.driving);
    expect(CAR_TEXT.driving.endsWith(' · <b>[F]</b> lights')).toBe(true);
    expect(CAR_TEXT.getIn).not.toMatch(/\[F\]/);
  });

  it('game.ts: the gameplay F line asks the car first; the transit line is unchanged', () => {
    const src = readFileSync(here('../src/game.ts'), 'utf8');
    expect(src.split("if (inp.hit('KeyF') && !this.skywaysCar?.onLightKey()) this.toggleFlashlight();").length).toBe(2);
    expect(src).toContain("if (inp.hit('KeyF')) this.toggleFlashlight(); // task campaign-polish (lane TRAIN, item 15)");
  });

  it('the state is the car\'s: kept when the player gets out (a parked car keeps its lamps), stored, restored at the next build; teardown removes the beam', () => {
    const {h, car} = carHost();
    enter(h, car);
    expect(car.onLightKey()).toBe(true);
    stopAndExit(h, car);
    expect(car.lights).toBe(true); // (chosen: the lamps stay as they were switched)
    expect(car.beam!.light.intensity).toBe(CAR_LAMPS.beam.intensity);
    expect(car.onLightKey()).toBe(false); // outside: F is the flashlight again
    expect((h.store.get(SKYWAYS_CAR_LANE) as {lights: boolean}).lights).toBe(true);
    const beam = car.beam!;
    teardown(h);
    expect(beamIn(h.scene)).toHaveLength(0);
    expect(lightsIn(h.scene)).toHaveLength(0);
    expect((h.store.get(SKYWAYS_CAR_LANE) as {lights: boolean}).lights).toBe(true);
    build(h);
    expect(car.lights).toBe(true);
    expect(car.beam).toBe(beam); // the same light every visit (stable: the same programs)
    expect(beamIn(h.scene)).toEqual([beam.light]);
    expect(beam.light.intensity).toBe(CAR_LAMPS.beam.intensity);
    expect(car.view!.lens!.emissiveIntensity).toBe(CAR_LAMPS.lens.on);
    // an old v1 record: lamps off
    teardown(h);
    const r = h.store.get(SKYWAYS_CAR_LANE) as {x: number; y: number; z: number; yaw: number; level: number};
    h.store.set(SKYWAYS_CAR_LANE, {v: 1, x: r.x, y: r.y, z: r.z, yaw: r.yaw, level: r.level});
    build(h);
    expect(car.source).toBe('record');
    expect(car.lights).toBe(false);
    expect(beam.light.intensity).toBe(0);
    // a layout without the car: no beam in the scene
    teardown(h);
    (h as {layout: unknown}).layout = {props: []};
    build(h);
    expect(beamIn(h.scene)).toHaveLength(0);
    expect(car.onLightKey()).toBe(false);
  });

  it('death / a state change while seated: the player is out, the lamps stay as the car\'s state', () => {
    const {h, car} = carHost();
    enter(h, car);
    car.onLightKey();
    h.player.alive = false;
    frame(h, car);
    expect(car.driving).toBe(false);
    expect(car.lights).toBe(true);
    expect(car.onLightKey()).toBe(false);
    h.player.alive = true;
    enter(h, car);
    car.onLightKey();
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('title', 'playing');
    expect(car.driving).toBe(false);
    expect(car.lights).toBe(false);
    expect((h.store.get(SKYWAYS_CAR_LANE) as {lights: boolean}).lights).toBe(false);
  });
});
