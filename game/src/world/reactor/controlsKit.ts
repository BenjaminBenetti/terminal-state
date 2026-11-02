// Task reactor-expansion-20261101 (lane CONTROLS): lane ARCH's kit pieces that HOST mounted controls, planned through the mounted-
// control rule (world/reactor/controlsMount.ts) — archKit.ts planSite / planGenerator call in here (one hook line each):
//  - the restart sites' machines (switchgear bank, coolant pump, coolant valve, control console) are placed FROM THEIR MACHINE
//    FOOTPRINTS (the collider), measured face on the footprint front, long axis along the footprint (the pump's 90 deg error);
//    a Meshy model where loaded, else a procedural stand-in whose faces sit where the model's are (so the overlays touch either);
//  - a generator's start control box stands flush on the generator model's measured END / SIDE face toward its panel point, on a
//    post to the deck (grounded), lever + lamps on its front.

import * as THREE from 'three';
import type {ReactorGenerator, ReactorSite} from '../../gen/reactor/reactorTypes';
import {boxMatrix, cylMatrix, type KitPlan, type KitRef} from './archKit';
import {GENERATOR_PANEL, HOST_DIMS, HOST_FACES, deskFrame, generatorPanelPose, hostToWorld, siteFloorY, siteHosts, type HostPlacement} from './controlsMount';

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** The host placement's model matrix (position, rotation.y, per-axis scale). */
export function hostMatrix(h: Pick<HostPlacement, 'x' | 'y' | 'z' | 'rotY' | 'sx' | 'sy' | 'sz'>): THREE.Matrix4 {
  return new THREE.Matrix4().compose(_p.set(h.x, h.y, h.z), _q.setFromAxisAngle(UP, h.rotY), _s.set(h.sx, h.sy, h.sz));
}

/** A box in the host's MODEL space (centre, size in model metres; scaled with the host), optionally tilted about model X. */
function hostBox(plan: KitPlan, h: HostPlacement, mat: Parameters<KitPlan['add']>[1], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, band: number, tiltX = 0): KitRef | null {
  _l.compose(_p.set(cx, cy, cz), _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltX), _s.set(sx, sy, sz));
  return plan.add('box', mat, _m.copy(hostMatrix(h)).multiply(_l).clone(), band);
}
function hostCyl(plan: KitPlan, h: HostPlacement, mat: Parameters<KitPlan['cyl']>[1], a: [number, number, number], b: [number, number, number], d: number, geo: 'cyl' | 'tube' = 'cyl'): KitRef | null {
  const A = hostToWorld(h, a[0], a[1], a[2]), B = hostToWorld(h, b[0], b[1], b[2]);
  return plan.add(geo, mat, cylMatrix(A, B, d * Math.min(h.sx, h.sz)), plan.bandOf(Math.min(A.y, B.y) + 0.05));
}

/** The restart site's host machines: from the footprints (models where loaded, else stand-ins with the models' faces). */
export function planMountedSite(plan: KitPlan, site: ReactorSite): void {
  const floorY = siteFloorY(plan.info, site);
  for (const h of siteHosts(site, floorY)) {
    const band = plan.bandOf(h.y + 0.1);
    const [W, H, D] = HOST_DIMS[h.piece];
    if (plan.canModel(h.piece)) plan.placeModel(h.piece, hostMatrix(h), band, [W * h.sx, H * h.sy, D * h.sz]);
    else standIn(plan, h, band);
    plan.stats.machines++;
  }
}

/** Procedural stand-ins (a model failed to load / Node tests): the same mounting faces as the measured models. */
function standIn(plan: KitPlan, h: HostPlacement, band: number): void {
  const [W, H] = HOST_DIMS[h.piece];
  switch (h.piece) {
    case 'switchgear': {
      const F = HOST_FACES.switchgear, d = F.doorZ - F.backZ, zc = (F.doorZ + F.backZ) / 2;
      hostBox(plan, h, 'machine', 0, (H - 0.1) / 2, zc, W * 0.98, H - 0.1, d, band);
      hostBox(plan, h, 'steelDark', 0, H - 0.05, zc, W, 0.1, d + 0.04, band);
      hostBox(plan, h, 'black', 0.19, 1.23, F.doorZ + 0.02, 0.26, 0.24, 0.04, band); // toggle cluster (outside the clear door rect)
      hostBox(plan, h, 'yellow', 0.3, H * 0.82, F.doorZ + 0.006, 0.18, 0.12, 0.012, band); // warning plate
      break;
    }
    case 'coolantPump': {
      const P = HOST_FACES.coolantPump;
      hostBox(plan, h, 'steelDark', 0, 0.1, 0, W, 0.2, 1.36, band); // skid
      hostCyl(plan, h, 'machine', [P.endX, P.disc.y, 0], [-0.45, P.disc.y, 0], P.disc.r * 2 + 0.04); // motor: end cover = the mount face
      hostCyl(plan, h, 'pipe', [0.9, 0.95, -0.45], [0.9, 0.95, 0.45], 1.0); // volute
      hostCyl(plan, h, 'pipe', [1.45, 0.95, 0], [W / 2, 0.95, 0], 0.5, 'tube'); // discharge
      break;
    }
    case 'coolantValve': {
      const V = HOST_FACES.coolantValve;
      hostCyl(plan, h, 'pipe', [-W / 2, 0.55, 0], [W / 2, 0.55, 0], 0.5, 'tube'); // the line through the valve
      hostBox(plan, h, 'steelDark', 0, 0.85, 0.02, 0.5, 0.6, 0.66, band); // body / bonnet (front at the lamp's z)
      hostCyl(plan, h, 'steelDark', [0, 1.15, 0], [0, V.wheel.cutY - 0.01, 0], 0.08, 'tube'); // stem (the wheel is the restart's)
      break;
    }
    case 'controlConsole': {
      const df = deskFrame(), D = HOST_DIMS.controlConsole[2];
      hostBox(plan, h, 'machine', 0, 0.3, (-D / 2 + 0.46) / 2, W, 0.6, 0.46 + D / 2, band); // base
      hostBox(plan, h, 'steelDark', 0, 0.75, 0.6, W, 0.05, 0.3, band); // desk ledge
      const zc = (df.z0 + df.z1) / 2, len = Math.hypot(df.z1 - df.z0, df.yAt(df.z1) - df.yAt(df.z0));
      hostBox(plan, h, 'machine', 0, df.yAt(zc) - 0.03 * df.n.y, zc - 0.03 * df.n.z, W, 0.06, len, band, Math.atan2(df.u.y, -df.u.z)); // sloped desk
      hostBox(plan, h, 'machine', 0, 1.05, -0.4, W, 0.9, 0.7, band); // instrument hood
      break;
    }
  }
}

/**
 * A generator's start control box: flush on the generator model's measured end / side face toward its panel point (EMBED into it),
 * on a post to the deck, the yellow start lever and two lamps (red = off, green = running) on its front. Returns the lamps.
 */
export function planGeneratorPanel(plan: KitPlan, g: ReactorGenerator, model: boolean, band: number): [KitRef, KitRef] {
  const {cx, py, cz, n, yaw} = generatorPanelPose(g, model);
  const {w: BW, h: BH, d: BD} = GENERATOR_PANEL;
  plan.add('box', 'machine', boxMatrix(cx, py, cz, BW, BH, BD, yaw), band);
  if (py - BH / 2 > g.y + 0.1) plan.cyl('tube', 'steelDark', {x: cx, y: g.y, z: cz}, {x: cx, y: py - BH / 2 + 0.01, z: cz}, 0.09); // its post
  const fx = cx + n.x * BD / 2, fz = cz + n.z * BD / 2; // the box front
  plan.add('box', 'yellow', boxMatrix(fx + n.x * 0.03, py - 0.24, fz + n.z * 0.03, 0.12, 0.2, 0.06, yaw), band); // start lever
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lamp = (lx: number, color: number): KitRef => plan.add('bulb', 'panelLamp', boxMatrix(fx + lx * c + n.x * 0.02, py + 0.24, fz - lx * s + n.z * 0.02, 0.08, 0.08, 0.08), band, color)!;
  return [lamp(-0.14, 0xff3020), lamp(0.14, 0x103010)];
}
