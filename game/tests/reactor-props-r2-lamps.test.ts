// Task reactor-playtest-round2-20261102 (lane PROPS), user bullets 10 + 13 on the Reactor:
//  (10) "lights have strange box in in front of them (picture)": every lamp's glass is a jar glow INSIDE its cage (world/reactor/
//       propsLampGlass.ts), fitted between the flood-lamp model's measured glass and its cage bars; the light's flat tube box (the plate
//       in front of the cage) is collapsed; the glass keeps the lighting's per-fixture colour (lit / held circuit 2 / flicker);
//  (13) "strange floating disks with lights on top over some objects (pic) (remove)": no disc + bulb "beacon" anywhere in the Reactor
//       world build (the restart sites' lamps over the valve / switchgear / pump / console, the pump tops, the manifold stands, the waste
//       repository's beacons); the core's remaining status lamps sit on a box face.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {testMeshOf} from './reactor-x-paths-meshes';
import {archFixtureInfo} from './reactor-arch-fixture';
import {LEVELS} from '../src/levels/registry';
import type {LightPlacement, StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {StationLighting} from '../src/world/lights';
import {KitPlan} from '../src/world/reactor/archKit';
import {REACTOR_MODELS} from '../src/world/reactor/archAssets';
import {isMounted, planMountedLamps} from '../src/world/reactor/gaslightFixtures';
import {JAR_R, LAMP_GLASS, lampGlassGeometry} from '../src/world/reactor/propsLampGlass';
import {coreHeroOf} from '../src/world/reactor/coreHero';
import {buildWasteVisuals} from '../src/world/reactor/wasteVisuals';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const FIXTURE = {w: 1.2, h: 0.19, d: 0.17};
/** A matrix's column lengths (Matrix4.decompose answers 1, 1, 1 for a singular matrix: the collapsed instances). */
const scaleOf = (m: THREE.Matrix4, s = new THREE.Vector3()) => s.set(new THREE.Vector3().setFromMatrixColumn(m, 0).length(), new THREE.Vector3().setFromMatrixColumn(m, 1).length(), new THREE.Vector3().setFromMatrixColumn(m, 2).length());

/** The cooked flood-lamp's vertices (model frame). */
function lampVerts(): THREE.Vector3[] {
  const t = testMeshOf(REACTOR_MODELS.floodLamp.url)!;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < t.length; i += 3) out.push(new THREE.Vector3(t[i], t[i + 1], t[i + 2]));
  return out;
}

/**
 * The "disc + bulb" pattern in a built group: every small bulb (sphere / icosahedron instance, r < 0.2 m) and every short upright disc
 * (closed cylinder instance <= 0.12 m tall, r <= 0.3 m); a bulb whose bottom sits on / just over a disc under it is a beacon.
 */
function beaconsIn(root: THREE.Object3D) {
  const bulbs: {c: THREE.Vector3; r: number; name: string}[] = [], discs: {c: THREE.Vector3; r: number; top: number}[] = [];
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isMesh) return;
    const t = mesh.geometry.type, prm = (mesh.geometry as THREE.CylinderGeometry).parameters as {radiusTop?: number; height?: number; openEnded?: boolean; radius?: number} | undefined;
    const isBulb = t === 'IcosahedronGeometry' || t === 'SphereGeometry';
    const isDisc = t === 'CylinderGeometry' && !prm?.openEnded;
    if (!isBulb && !isDisc) return;
    const n = mesh.isInstancedMesh ? mesh.count : 1;
    for (let k = 0; k < n; k++) {
      if (mesh.isInstancedMesh) mesh.getMatrixAt(k, m); else m.identity();
      m.premultiply(mesh.matrixWorld);
      scaleOf(m, s); p.setFromMatrixPosition(m);
      if (Math.min(s.x, s.y, s.z) < 1e-6) continue; // a collapsed instance draws nothing
      const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
      if (isBulb) { const r = (prm?.radius ?? 0.5) * Math.max(s.x, s.y, s.z); if (r > 0 && r < 0.2) bulbs.push({c: p.clone(), r, name: mesh.name}); }
      else {
        const h = (prm?.height ?? 1) * s.y, r = (prm?.radiusTop ?? 0.5) * Math.max(s.x, s.z);
        if (h > 0 && h <= 0.12 && r <= 0.3 && Math.abs(up.y) > 0.999) discs.push({c: p.clone(), r, top: p.y + h / 2});
      }
    }
  });
  const beacons = bulbs.filter(b => discs.some(d => Math.hypot(d.c.x - b.c.x, d.c.z - b.c.z) < Math.max(0.12, d.r) && b.c.y - b.r - d.top > -0.03 && b.c.y - b.r - d.top < 0.15));
  return {bulbs, discs, beacons};
}

describe('lamp glass (bullet 10): a jar inside the cage, never a plate in front of it', () => {
  it('the jar glow fits between the flood-lamp model\'s measured glass and its cage bars (cooked GLB)', () => {
    const V = lampVerts(), J = LAMP_GLASS.jar;
    const r = (v: THREE.Vector3) => Math.hypot(v.x - J.x, v.z - J.z);
    // the model's glass shell at mid height (below the collar, above the bottom curve) and the cage bars round it
    const mid = V.filter(v => v.y > 0.075 && v.y < 0.105);
    const glass = Math.max(...mid.filter(v => r(v) < 0.09).map(r)), bars = Math.min(...V.filter(v => v.y > 0.06 && v.y < 0.2 && r(v) >= 0.09).map(r));
    expect(glass).toBeLessThanOrEqual(LAMP_GLASS.glassR + 0.002);
    expect(bars).toBeGreaterThanOrEqual(LAMP_GLASS.cageR - 0.002);
    // the lathe: its flat faces (r cos(pi / n)) stay outside the glass, its corners inside the bars
    const inner = JAR_R * Math.cos(Math.PI / LAMP_GLASS.segments);
    expect(inner).toBeGreaterThan(glass + 0.003);
    expect(JAR_R).toBeLessThan(bars - 0.003);
    // its outside faces point out (front faces are the glass the player sees)
    const g = lampGlassGeometry(), pos = g.attributes.position, idx = g.index!;
    let out = 0, inward = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
      const n = b.clone().sub(a).cross(c.clone().sub(a)), m = a.clone().add(b).add(c).divideScalar(3);
      if (Math.abs(n.y) > 0.5 * n.length() || n.lengthSq() < 1e-14) continue; // the caps
      if (n.x * m.x + n.z * m.z > 0) out++; else inward++;
    }
    expect(inward).toBe(0);
    expect(out).toBeGreaterThanOrEqual(2 * 2 * LAMP_GLASS.segments); // (the steep sides: two profile spans x 16 segments x 2 triangles)
  });

  it('a mounted wall lamp on the model: its glass is inside the model\'s cage (nothing past the cage front), its tube collapsed', () => {
    const plan = new KitPlan(archFixtureInfo(), {models: new Set(['floodLamp']), fixtures: true});
    const lights: LightPlacement[] = [0, Math.PI / 2, 2.2].map((a, k) => ({
      x: 21 + Math.sin(a) * 0.38, y: -7.45, z: 30 + 4 * k + Math.cos(a) * 0.38, rot: 0, area: 0, broken: false, flicker: false, warm: true, power: 0.9, dying: true,
      mount: {kind: 'wall', x: 21, y: -7.45, z: 30 + 4 * k, nx: Math.sin(a), nz: Math.cos(a)},
    }));
    const recs = planMountedLamps(plan, lights, FIXTURE);
    expect(recs.length).toBe(3);
    const placed = plan.modelPlacements.get('floodLamp')!;
    const bodyV = lampVerts();
    const front = Math.max(...bodyV.map(v => v.z)); // the model's own front (the cage's front bars)
    const geo = lampGlassGeometry(), pos = geo.attributes.position;
    recs.forEach((rec, k) => {
      expect(rec.model).toBe(true);
      const s = scaleOf(rec.lens);
      expect(Math.max(s.x, s.y, s.z)).toBe(0); // no tube plate
      const toModel = placed[k].m.clone().invert(), v = new THREE.Vector3();
      let zMax = -Infinity, rMax = 0, yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(rec.glass).applyMatrix4(toModel);
        zMax = Math.max(zMax, v.z); yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y);
        rMax = Math.max(rMax, Math.hypot(v.x - LAMP_GLASS.jar.x, v.z - LAMP_GLASS.jar.z));
      }
      expect(zMax).toBeLessThan(front - 0.01); // the old plate stood at z 0.205 .. 0.235, past the cage's 0.219 front
      expect(rMax).toBeLessThan(LAMP_GLASS.cageR);
      expect(yMin).toBeGreaterThan(0);
      expect(yMax).toBeLessThan(0.23); // up into the collar, never above it
    });
  });

  it('bullet 13: the beacon scan finds the removed pattern (a 0.16 m disc + a 0.065 m bulb on it, as the restart sites drew)', () => {
    const g = new THREE.Group(), y = 1.3;
    const disc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false), new THREE.MeshBasicMaterial(), 1);
    disc.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(2, y + 0.035, 3), new THREE.Quaternion(), new THREE.Vector3(0.16, 0.07, 0.16)));
    const bulb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial(), 1);
    bulb.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(2, y + 0.13, 3), new THREE.Quaternion(), new THREE.Vector3(0.13, 0.13, 0.13)));
    g.add(disc, bulb);
    expect(beaconsIn(g).beacons.length).toBe(1);
  });

  describe('a real Reactor world (seed 9100, the flood-lamp model loaded as a stand-in)', () => {
    let L: StationLayout, w: BuiltWorld;
    beforeAll(() => {
      L = LEVELS.reactor.generate('main', {levelSeed: 9100});
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.45, 0.44).translate(0, 0.225, 0), new THREE.MeshStandardMaterial());
      const scene = new THREE.Group(); scene.add(lamp);
      w = buildWorld(L, mats(), {[REACTOR_MODELS.floodLamp.key]: {scene} as unknown as GLTF});
    }, 180_000);

    it('every pit / mine lamp shows a jar in its cage; no lamp keeps a tube box; the lighting drives the glass colour', () => {
      const arch = w.reactorArch!, glass = arch.lampGlass!;
      expect(glass).toBeTruthy();
      expect(glass.instanceColor).toBe(w.tubes!.instanceColor);
      const lamps = L.lights.map((l, i) => [l, i] as const).filter(([l]) => arch.isLamp(l));
      expect(lamps.length).toBeGreaterThan(40);
      expect(arch.mountedLamps.some(r => r.model)).toBe(true); // the model path is covered
      expect(arch.mountedLamps.some(r => !r.model)).toBe(true); // and the procedural cages
      expect(lamps.some(([l]) => !isMounted(l))).toBe(true); // and the mines' pendant cages
      const m = new THREE.Matrix4(), s = new THREE.Vector3();
      for (const [l, i] of lamps) {
        w.tubes!.getMatrixAt(i, m); scaleOf(m, s);
        expect(Math.max(s.x, s.y, s.z), `light ${i}: tube box`).toBe(0);
        glass.getMatrixAt(i, m); scaleOf(m, s);
        expect(Math.min(s.x, s.y, s.z), `light ${i}: glass`).toBeGreaterThan(0.8);
        const c = new THREE.Vector3(0, 0.111, 0).applyMatrix4(m);
        expect(Math.hypot(c.x - l.x, c.z - l.z), `light ${i}: glass at its lamp`).toBeLessThan(0.4);
      }
      // the station's own tube fixtures (rooms, the rim station) keep their tubes
      const tubeLights = L.lights.map((l, i) => [l, i] as const).filter(([l]) => !l.virtual && !arch.isLamp(l));
      expect(tubeLights.length).toBeGreaterThan(10);
      for (const [, i] of tubeLights.slice(0, 20)) { w.tubes!.getMatrixAt(i, m); expect(scaleOf(m, s).x).toBeGreaterThan(0.5); }
      // a held circuit-2 lamp's glass reads dark, a steady emergency lamp's lit (the shared colour attribute)
      const lp = new StationLighting(new THREE.Scene(), L, w.fixtures, w.tubes);
      lp.circuitLevel = [null, null, 0];
      lp.update(0.016);
      const held = lamps.find(([l]) => l.dying)!, steady = lamps.find(([l]) => !l.dying && !l.broken && !l.flicker)!;
      const c = new THREE.Color();
      glass.getColorAt(held[1], c); expect(c.r).toBeLessThan(0.05);
      glass.getColorAt(steady[1], c); expect(c.r).toBeGreaterThan(0.1);
      lp.dispose();
    });

    it('bullet 13: no disc + bulb "beacon" anywhere in the world build; the core status lamps sit on a box face; no waste beacons', () => {
      const {bulbs, beacons} = beaconsIn(w.group);
      expect(bulbs.length).toBeGreaterThan(20);
      expect(beacons.map(b => `${b.name} at ${b.c.toArray().map(v => v.toFixed(2))}`)).toEqual([]);
      // the core's status lamps: none at the restart sites, every power / valve / pump lamp on a box face (no gap, nothing to float on)
      const hero = coreHeroOf(w.reactorArch!.plan!)!;
      expect(hero.lamps.filter(l => l.site)).toEqual([]);
      const boxes = [...w.reactorArch!.plan!.parts.values()].filter(pt => pt.geo === 'box').flatMap(pt => pt.list.map(i => i.m));
      const inv = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3();
      for (const l of hero.lamps.filter(x => x.group === 'power' || x.group === 'valve' || x.group === 'pump')) {
        const gap = Math.min(...boxes.map(bm => {
          v.set(l.x, l.y, l.z).applyMatrix4(inv.copy(bm).invert()); // unit box space
          scaleOf(bm, s);
          const dx = Math.max(0, Math.abs(v.x) - 0.5) * s.x, dy = Math.max(0, Math.abs(v.y) - 0.5) * s.y, dz = Math.max(0, Math.abs(v.z) - 0.5) * s.z;
          return Math.hypot(dx, dy, dz);
        }));
        expect(gap, `${l.group} lamp at ${l.x.toFixed(1)},${l.y.toFixed(2)},${l.z.toFixed(1)}`).toBeLessThan(l.r + 0.01);
      }
      // the waste repository draws no beacon bulbs
      const g = new THREE.Group();
      buildWasteVisuals(g, L, mats(), {});
      const wasteBulbs = g.children.filter(o => (o as THREE.Mesh).geometry?.type === 'IcosahedronGeometry');
      expect(wasteBulbs.reduce((n, o) => n + ((o as THREE.InstancedMesh).count ?? 1), 0)).toBe(0);
    });
  });
});
