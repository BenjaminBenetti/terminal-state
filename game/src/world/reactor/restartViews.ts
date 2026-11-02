// Task reactor-build-20261101 (lane RESTART): the INTERACTIVE OVERLAYS of the restart controls and the canvas screen planes. Lane ARCH
// renders the machines themselves from the Meshy kit (switchgear sections, coolant pump + valve, control console); this file adds only
// what moves or lights with the restart state:
//  - 'fuse-0' / 'fuse-1': a fuse carrier with brass clips, the SEATED CARTRIDGE (the fuse_cartridge item model = the kit GLB) once
//    fitted, a red / green lamp;
//  - 'breaker': the main breaker handle (down = open, swings up while E is held, up = closed), OFF / ON lamps;
//  - 'valve': the coolant handwheel, TURNING while E is held (2.5 turns), shut / open lamp;
//  - 'pump': the pump station (start / stop buttons, RUN lamp) and a flow spinner that spools up when the pump starts;
//  - 'keyswitch': the key switch; the startup key (the reactor_key item model) sits in it once inserted, KEY / RUN lamp;
//  - 'rods': the rod-withdrawal T-handle (slides up while E is held) and four task lamps KEY · POWER · COOLANT · RODS.
// Task reactor-expansion-20261101 (lane CONTROLS): every overlay is built in its MOUNT frame (world/reactor/controlsMount.ts: origin
// on the host model's measured face, +Z out of it, +Y up it): back planes sit EMBED m inside the face, nothing floats in front of it;
// housings take the host's look (controlsSkin.ts controlSkin(host): the Codex rusted-steel set tinted to the host's measured paint),
// functional parts the existing painted / brushed steel sets; the coolant valve's handwheel is the valve model's OWN wheel
// (controlsModel.ts local mesh separation), turned about its stem.
// Geometry / materials are module singletons (never disposed, like the elevator's); the screens' canvas textures / materials /
// planes are per world (disposed by the runtime). Allocation-free per frame.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {ReactorControl, ReactorScreen} from '../../gen/reactor/reactorTypes';
import type {ReactorRunState, ReactorTaskStatus} from './runState';
import type {RestartControlId} from './restartLogic';
import {makeSupplyMesh} from '../pickups';
import {EMBED, HOST_FACES, controlFrontOf, hostOfControl, type HostPlacement, type MountedControl} from './controlsMount';
import {controlSkin, lampSkin, type LampKey, type SkinKey} from './controlsSkin';
import type {HostPart} from './controlsModel';

// ---------------------------------------------------------------------------------------------
// Shared geometry

const geos = new Map<string, THREE.BufferGeometry>();
const G = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => {
  let g = geos.get(key);
  if (!g) { g = make(); geos.set(key, g); }
  return g;
};
const boxG = (w: number, h: number, d: number) => G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
/** Cylinder along local Z (a button / lens / hub facing the front). */
const cylZ = (r: number, len: number) => G(`cz${r},${len}`, () => new THREE.CylinderGeometry(r, r, len, 18).rotateX(Math.PI / 2));
const sphere = (r: number) => G(`s${r}`, () => new THREE.SphereGeometry(r, 12, 8));

function mesh(geo: THREE.BufferGeometry, mat: SkinKey | THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? controlSkin(mat) : mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
/** A mounting plate w x h: from EMBED inside the host face (z = -EMBED) out to z = t. */
function plate(w: number, h: number, t: number, x: number, y: number, mat: SkinKey, parent: THREE.Object3D): THREE.Mesh {
  return mesh(boxG(w, h, t + EMBED), mat, x, y, (t - EMBED) / 2, parent);
}

/** A signal lamp (a dark lens until lit), half sunk into what it sits on. */
class Lamp {
  readonly mesh: THREE.Mesh;
  private on: LampKey | '?' = '?';
  constructor(parent: THREE.Object3D, x: number, y: number, z: number, r = 0.018) {
    this.mesh = mesh(sphere(r), lampSkin('lens'), x, y, z, parent);
  }
  set(color: 'green' | 'red' | 'amber' | null): void {
    const k: LampKey = color === 'green' ? 'litGreen' : color === 'red' ? 'litRed' : color === 'amber' ? 'litAmber' : 'lens';
    if (k === this.on) return;
    this.on = k;
    this.mesh.material = lampSkin(k);
  }
}

// ---------------------------------------------------------------------------------------------
// Control overlays

export interface ControlView {
  id: RestartControlId;
  root: THREE.Group;
  /** Restart state changed (lamps, seated parts, final handle poses). `tasks` = reactorTasks(state). */
  sync(s: ReactorRunState, tasks: {key: ReactorTaskStatus; power: ReactorTaskStatus; coolant: ReactorTaskStatus; rods: ReactorTaskStatus}): void;
  /** Per frame: `hold` 0..1 while E is held on this control (else 0); dt for the pump spinner. */
  animate(dt: number, hold: number): void;
  /** Pump spool 0..1 (screens). */
  readonly spool: number;
}

/** Unit front normal of a control: toward its stand point (authoritative: "the panel faces the stand point"), else its yaw. */
export function controlFront(c: Pick<ReactorControl, 'at' | 'stand' | 'yaw'>): [number, number] {
  return controlFrontOf(c);
}

const STATUS_LAMP: Record<ReactorTaskStatus, 'green' | 'amber' | 'red'> = {done: 'green', ready: 'amber', blocked: 'red'};

/** A control without a computed mount: its own point, facing its stand (old layouts / direct callers). */
export function fallbackMount(c: ReactorControl): MountedControl {
  const [fx, fz] = controlFrontOf(c);
  return {id: c.id, host: null, placement: -1, x: c.at.x, y: c.at.y, z: c.at.z, nx: fx, ny: 0, nz: fz, ux: 0, uy: 1, uz: 0, pick: {...c.at}, fx, fz};
}

/** The overlay root's pose: the mount frame (right = up x normal). */
function placeOnMount(root: THREE.Object3D, m: MountedControl): void {
  const n = new THREE.Vector3(m.nx, m.ny, m.nz), u = new THREE.Vector3(m.ux, m.uy, m.uz), r = new THREE.Vector3().crossVectors(u, n);
  root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, n));
  root.position.set(m.x, m.y, m.z);
}

/**
 * The overlay of restart control `id`. `mount` = its mount on the host face (controlsMount.ts siteMounts; omitted: at the control
 * point facing its stand), `host` = the host model placement (the valve: its own wheel turns about the stem), `wheel` = the valve
 * model's separated handwheel (controlsModel.ts valveWheelPart; null: a stand-in wheel in the same place).
 */
export function buildControlView(id: RestartControlId, c: ReactorControl, mount?: MountedControl, host?: HostPlacement, wheel?: HostPart | null): ControlView {
  const root = new THREE.Group();
  root.name = `reactor-control-${id}`;
  const m = mount ?? fallbackMount(c);
  const skin: SkinKey = m.host ?? hostOfControl(id) ?? 'switchgear';
  const onHost = id === 'valve' && !!host;
  if (onHost) { root.position.set(host!.x, host!.y, host!.z); root.rotation.y = host!.rotY; } else placeOnMount(root, m);
  let spool = 0, pumpOn = false, done = false;
  const view: ControlView = {id, root, get spool() { return spool; }, sync: () => {}, animate: () => {}};
  switch (id) {
    case 'fuse-0': case 'fuse-1': {
      plate(0.38, 0.18, 0.015, 0, 0.02, skin, root); // carrier mount (the cabinet's paint)
      mesh(boxG(0.34, 0.1, 0.015), 'phenolic', 0, 0, 0.0225, root); // fuse base
      mesh(boxG(0.03, 0.07, 0.04), 'brass', -0.135, 0, 0.05, root);
      mesh(boxG(0.03, 0.07, 0.04), 'brass', 0.135, 0, 0.05, root);
      const cart = makeSupplyMesh('fuse_cartridge'); // the kit GLB (or its stand-in): length along X, bottom at y 0, r 0.031
      cart.position.set(0, -0.031, 0.061); // seated on the base, between the clips
      cart.visible = false;
      cart.name = 'seated-cartridge';
      root.add(cart);
      const lamp = new Lamp(root, 0, 0.085, 0.015);
      const slot = id === 'fuse-0' ? 0 : 1;
      view.sync = s => { cart.visible = !!s.fuses[slot]; lamp.set(s.fuses[slot] ? 'green' : 'red'); };
      break;
    }
    case 'breaker': {
      plate(0.18, 0.32, 0.02, 0, 0, skin, root);
      mesh(cylZ(0.026, 0.03), 'steel', 0, -0.06, 0.035, root); // pivot boss
      const pivot = new THREE.Group();
      pivot.position.set(0, -0.06, 0.045);
      root.add(pivot);
      mesh(boxG(0.03, 0.13, 0.03), 'red', 0, 0.065, 0, pivot);
      mesh(boxG(0.07, 0.03, 0.04), 'red', 0, 0.14, 0, pivot);
      const off = new Lamp(root, -0.055, 0.125, 0.02), on = new Lamp(root, 0.055, 0.125, 0.02);
      const OPEN = 2.25, CLOSED = 0.35;
      view.sync = s => { done = s.breaker; off.set(s.breaker ? null : 'amber'); on.set(s.breaker ? 'green' : null); pivot.rotation.x = s.breaker ? CLOSED : OPEN; };
      view.animate = (_dt, hold) => { if (!done) pivot.rotation.x = OPEN + (CLOSED - OPEN) * hold; };
      break;
    }
    case 'valve': {
      const W = HOST_FACES.coolantValve.wheel;
      // the wheel turns about the valve's stem (model-local Y through x = z = 0); without a host: a wheel facing the operator
      const pivot = new THREE.Group();
      root.add(pivot);
      if (!onHost) pivot.position.set(0, 0, 0.04);
      if (onHost && wheel) {
        const w = new THREE.Mesh(wheel.geometry, wheel.material);
        w.name = 'valve-model-handwheel';
        w.matrixAutoUpdate = false;
        w.matrix.copy(wheel.matrix);
        pivot.add(w);
      } else {
        const g = new THREE.Group();
        if (onHost) { g.position.set(0, W.y, 0); g.rotation.x = -Math.PI / 2; }
        pivot.add(g);
        mesh(G('wheel-rim', () => new THREE.TorusGeometry(W.r - 0.02, 0.02, 8, 32)), 'wheelRed', 0, 0, 0, g);
        for (let i = 0; i < 3; i++) { const sp = mesh(boxG((W.r - 0.02) * 2, 0.022, 0.016), 'wheelRed', 0, 0, 0, g); sp.rotation.z = (i * Math.PI) / 3; }
        mesh(cylZ(0.045, 0.06), 'steel', 0, 0, 0, g);
        if (!onHost) mesh(cylZ(0.03, 0.04 + EMBED), 'steel', 0, 0, -0.02 - EMBED / 2, pivot); // its stem into the face
      }
      const L = HOST_FACES.coolantValve.lamp;
      const lamp = onHost ? new Lamp(root, 0, L.y, L.z + 0.008) : new Lamp(root, 0, W.r + 0.05, 0.01);
      const TURNS = 2.5 * Math.PI * 2;
      const turn = (k: number) => { if (onHost) pivot.rotation.y = -TURNS * k; else pivot.rotation.z = TURNS * k; };
      view.sync = s => { done = s.valve; lamp.set(s.valve ? 'green' : 'red'); if (s.valve) turn(1); };
      view.animate = (_dt, hold) => { if (!done) turn(hold); };
      break;
    }
    case 'pump': {
      plate(0.22, 0.3, 0.05, 0, 0, skin, root); // start station on the motor end cover
      mesh(cylZ(0.03, 0.03), 'green', 0, 0.04, 0.065, root);
      mesh(cylZ(0.03, 0.03), 'red', 0, -0.05, 0.065, root);
      const run = new Lamp(root, 0, 0.11, 0.05);
      mesh(cylZ(0.02, 0.045 + EMBED), 'steel', 0.17, 0.02, (0.045 - EMBED) / 2, root); // the flow spinner's shaft, out of the cover
      const spinner = new THREE.Group();
      spinner.position.set(0.17, 0.02, 0.055);
      root.add(spinner);
      mesh(cylZ(0.06, 0.02), 'steel', 0, 0, 0, spinner);
      mesh(boxG(0.11, 0.018, 0.025), 'yellow', 0, 0, 0.004, spinner);
      let first = true;
      view.sync = s => { if (first && s.pump) spool = 1; first = false; pumpOn = s.pump; run.set(s.pump ? 'green' : null); }; // a restored running pump: already at speed
      view.animate = dt => {
        spool = pumpOn ? Math.min(1, spool + dt / 4) : 0;
        if (spool > 0) spinner.rotation.z -= dt * 14 * spool;
      };
      break;
    }
    case 'keyswitch': {
      plate(0.13, 0.17, 0.02, 0, 0, skin, root);
      mesh(cylZ(0.024, 0.03), 'brass', 0, 0, 0.035, root);
      const key = makeSupplyMesh('reactor_key'); // the kit GLB (or its stand-in): blade toward +X, lying flat
      key.rotation.set(Math.PI / 2, Math.PI / 2, 0, 'YXZ'); // on its edge, blade into the lock (-Z)
      key.position.set(0, 0, 0.1);
      key.visible = false;
      key.name = 'inserted-key';
      root.add(key);
      const lamp = new Lamp(root, 0, 0.065, 0.02);
      view.sync = s => { key.visible = s.keyInserted; lamp.set(s.keyInserted ? 'green' : 'amber'); };
      break;
    }
    case 'rods': {
      plate(0.16, 0.34, 0.02, 0, 0, skin, root);
      mesh(boxG(0.03, 0.26, 0.006), 'phenolic', 0, -0.02, 0.023, root); // the handle's slot
      const handle = new THREE.Group();
      root.add(handle);
      mesh(boxG(0.026, 0.06, 0.026), 'steel', 0, -0.03, 0.033, handle);
      mesh(boxG(0.15, 0.03, 0.03), 'yellow', 0, 0, 0.05, handle);
      const lamps = [-0.06, -0.02, 0.02, 0.06].map(x => new Lamp(root, x, 0.14, 0.02, 0.012));
      const IN = -0.11, OUT = 0.07;
      view.sync = (s, t) => {
        done = s.rods;
        lamps[0].set(STATUS_LAMP[t.key]); lamps[1].set(STATUS_LAMP[t.power]); lamps[2].set(STATUS_LAMP[t.coolant]); lamps[3].set(STATUS_LAMP[t.rods]);
        handle.position.y = s.rods ? OUT : IN;
      };
      view.animate = (_dt, hold) => { if (!done) handle.position.y = IN + (OUT - IN) * hold; };
      break;
    }
  }
  return view;
}

// ---------------------------------------------------------------------------------------------
// Screens (canvas texture on a self-lit plane; ARCH frames them)

export interface ScreenView {
  id: ReactorScreen['id'];
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement | null;
  texture: THREE.Texture;
  pw: number;
  ph: number;
  key: string;
  dispose(): void;
}

/**
 * The screen plane at its face centre, facing (-sin yaw, -cos yaw) (contract: camera convention) — or the opposite side when that
 * side is solid at the screen's level and the other one is open (`openAt`: is the point walkable air on that level). Pulled 1.5 cm
 * forward off ARCH's frame / backing.
 */
export function screenFacing(sc: ReactorScreen, openAt?: (x: number, z: number, level: number) => boolean): [number, number] {
  let nx = -Math.sin(sc.yaw), nz = -Math.cos(sc.yaw);
  if (openAt && !openAt(sc.x + nx * 0.6, sc.z + nz * 0.6, sc.level) && openAt(sc.x - nx * 0.6, sc.z - nz * 0.6, sc.level)) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

export function buildScreenView(sc: ReactorScreen, pw: number, ph: number, openAt?: (x: number, z: number, level: number) => boolean): ScreenView {
  const [nx, nz] = screenFacing(sc, openAt);
  const hasCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function';
  const canvas = hasCanvas ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = pw; canvas.height = ph; }
  const texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.DataTexture(new Uint8Array([8, 12, 10, 255]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const mat = new MeshBasicNodeMaterial({map: texture, color: new THREE.Color(0.86, 0.86, 0.86)});
  mat.name = `reactor-screen-${sc.id}`;
  const geo = new THREE.PlaneGeometry(Math.max(0.2, sc.w), Math.max(0.15, sc.h));
  const m = new THREE.Mesh(geo, mat);
  m.name = `reactor-screen-${sc.id}`;
  m.position.set(sc.x + nx * 0.015, sc.y, sc.z + nz * 0.015);
  m.rotation.y = Math.atan2(nx, nz);
  m.userData.level = sc.level;
  return {id: sc.id, mesh: m, canvas, texture, pw, ph, key: '', dispose: () => { texture.dispose(); mat.dispose(); geo.dispose(); }};
}
