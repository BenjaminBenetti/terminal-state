// Task studio-skyways-level-20261106-054448 (lane CAR2): the finished prize car — the runtime spec IS the measured anchors (SKYWAYS_CAR);
// the Meshy COCKPIT (lane ASSET-D's dash + seat, world/skywaysCarCockpit.ts cockpitLayout) checked against the real cooked geometry: the
// steering-wheel rim (measured on the dash mesh) centred in front of the driver's eye, the dash under the cowl -> header sight line and
// below the windscreen's bottom edge as seen from the eye, the driver seat under the eye facing the dash, every part / filler inside the
// car's closed shell, and no first-person ray from the eye ever reaching the hollow shell's engine bay; the view (the parts placed, the
// procedural cockpit only as a fallback); the car AUDIO — Sfx carEngine / stopCarEngine / carSkid / carDoor over the fake WebAudio
// context, and their wiring in the car (engine on entering / per frame / off on exit, death, a state change, teardown; the skid edge,
// rate-limited; the door on getting in and out).
import {describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {SKYWAYS_CAR} from '../src/assets/skywaysCar.generated';
import {SKYWAYS_MESHY_PROPS} from '../src/assets/skywaysMeshyProps.generated';
import {levelOfAsset} from '../src/assets/levelAssets';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {CABIN, COCKPIT_URLS, DASH_MODEL, FILL_COLOR, FIREWALL, SEAT_MODEL, cockpitLayout, fillMesh, posePoint, sightLineY, type CockpitPose} from '../src/world/skywaysCarCockpit';
import {buildCarView, setSkywaysCarModelsForTests} from '../src/world/skywaysCarModel';
import {CAR_RT} from '../src/world/skywaysCar';
import {CAR_PHYS} from '../src/world/skywaysCarPhysics';
import {CAR_AUDIO, CUE_GAIN, Sfx} from '../src/audio/sfx';
import {CUES} from '../src/audio/bank';
import {CLIP_MANIFEST_SKYWAYS_CAR} from '../src/audio/manifest.skywaysCar.generated';
import {FakeCtx, fakeBank, type Src} from './helpers/fakeAudio';
import {carHost, frame, press, run, teardown, type CarTestHost} from './helpers/skywaysCarHost';
import type {SkywaysCar} from '../src/world/skywaysCar';

const S = CAR_SPEC, L = cockpitLayout(S), E = S.eye;
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
type V3 = [number, number, number];
interface Mesh { P: ArrayLike<number>; I: ArrayLike<number> }

async function prim(url: string, node?: string): Promise<Mesh> {
  const root = (await new NodeIO().readBinary(new Uint8Array(readFileSync(pub(url))))).getRoot();
  const n = node ? root.listNodes().find(x => x.getName() === node)! : root.listNodes()[0];
  const p = n.getMesh()!.listPrimitives()[0];
  return {P: p.getAttribute('POSITION')!.getArray()!, I: p.getIndices()!.getArray()!};
}
const dash = await prim(COCKPIT_URLS.dash), seat = await prim(COCKPIT_URLS.seat);
const body = await prim(S.url, 'body'), glass = await prim(S.url, 'glass');

/** A part's vertices in the car frame. */
const placed = (m: Mesh, pose: CockpitPose): Float32Array => {
  const out = new Float32Array(m.P.length);
  for (let i = 0; i < m.P.length; i += 3) { const q = posePoint(pose, m.P[i], m.P[i + 1], m.P[i + 2]); out[i] = q.x; out[i + 1] = q.y; out[i + 2] = q.z; }
  return out;
};
const dashP = placed(dash, L.dash), seatsP = L.seats.map(p => placed(seat, p)), fill = fillMesh(L);
const bbox = (P: ArrayLike<number>) => {
  const mn: V3 = [Infinity, Infinity, Infinity], mx: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  return {mn, mx};
};

/** A triangle list packed for ray casts: per triangle [v0, e1, e2] (9 floats). */
const packed = new WeakMap<Mesh, Float64Array>();
function pack(m: Mesh): Float64Array {
  let T = packed.get(m);
  if (T) return T;
  const {P, I} = m;
  T = new Float64Array((I.length / 3) * 9);
  for (let t = 0, k = 0; t < I.length; t += 3, k += 9) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    T[k] = P[a]; T[k + 1] = P[a + 1]; T[k + 2] = P[a + 2];
    T[k + 3] = P[b] - P[a]; T[k + 4] = P[b + 1] - P[a + 1]; T[k + 5] = P[b + 2] - P[a + 2];
    T[k + 6] = P[c] - P[a]; T[k + 7] = P[c + 1] - P[a + 1]; T[k + 8] = P[c + 2] - P[a + 2];
  }
  packed.set(m, T);
  return T;
}
/** Nearest hit of a ray against a triangle list (Möller–Trumbore, both sides), Infinity = none. */
function hitT(m: Mesh, o: V3, d: V3, tmin = 1e-4): number {
  const T = pack(m), [ox, oy, oz] = o, [dx, dy, dz] = d;
  let best = Infinity;
  for (let k = 0; k < T.length; k += 9) {
    const e1x = T[k + 3], e1y = T[k + 4], e1z = T[k + 5], e2x = T[k + 6], e2y = T[k + 7], e2z = T[k + 8];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det, sx = ox - T[k], sy = oy - T[k + 1], sz = oz - T[k + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (tt > tmin && tt < best) best = tt;
  }
  return best;
}

/** Inside the car's closed shell (body + glass weld closed: skyways-car-asset.test.ts): odd crossings of an upward ray (xz-binned). */
const shellInside = (() => {
  const C = 0.1, bins = new Map<string, number[]>(), parts = [body, glass];
  parts.forEach(({P, I}, n) => {
    for (let t = 0; t < I.length; t += 3) {
      const xs = [P[3 * I[t]], P[3 * I[t + 1]], P[3 * I[t + 2]]], zs = [P[3 * I[t] + 2], P[3 * I[t + 1] + 2], P[3 * I[t + 2] + 2]];
      for (let bx = Math.floor(Math.min(...xs) / C); bx <= Math.floor(Math.max(...xs) / C); bx++) for (let bz = Math.floor(Math.min(...zs) / C); bz <= Math.floor(Math.max(...zs) / C); bz++) {
        const k = `${bx},${bz}`; let l = bins.get(k); if (!l) bins.set(k, (l = [])); l.push(n, t);
      }
    }
  });
  return (x: number, y: number, z: number): boolean => {
    x += 1.37e-5; z += 2.71e-5; // (off any shared edge / vertex)
    let n = 0;
    for (const l of [bins.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []]) for (let i = 0; i < l.length; i += 2) {
      const {P, I} = parts[l[i]], t = l[i + 1], a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
      if (Math.abs(d) < 1e-14) continue;
      const w0 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, w1 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      if (w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1] > y) n++;
    }
    return n % 2 === 1;
  };
})();

describe('skyways car: the measured spec', () => {
  it('the runtime spec is lane ASSET-B\'s measured SKYWAYS_CAR (one source for the anchors)', () => {
    expect(CAR_SPEC).toBe(SKYWAYS_CAR);
    expect(S.url).toBe('assets/models/skyways-prize-car.glb');
    expect(S.eye.x).toBeLessThan(-0.2); // the driver = the LEFT seat
  });
});

describe('skyways car: the Meshy cockpit', () => {
  it('the parts are lane ASSET-D\'s Skyways-only GLBs; the measured model constants match the registry and the geometry', () => {
    expect(COCKPIT_URLS.dash).toBe(SKYWAYS_MESHY_PROPS.skyways_car_dash.url);
    expect(COCKPIT_URLS.seat).toBe(SKYWAYS_MESHY_PROPS.skyways_car_seat.url);
    for (const u of Object.values(COCKPIT_URLS)) { expect(existsSync(pub(u))).toBe(true); expect(levelOfAsset(u)).toBe('skyways'); }
    for (const [m, r] of [[DASH_MODEL, SKYWAYS_MESHY_PROPS.skyways_car_dash], [SEAT_MODEL, SKYWAYS_MESHY_PROPS.skyways_car_seat]] as const) {
      expect(m.w).toBeCloseTo(r.w, 2); expect(m.h).toBeCloseTo(r.h, 2); expect(m.d).toBeCloseTo(r.d, 2);
    }
    // the steering-wheel rim measured again on the mesh: the vertices in its plane (|d| < 3 cm) at rim radius -> the in-plane centre
    const R = DASH_MODEL.ring, n = [R.nx, R.ny, R.nz], ln = Math.hypot(...n), N = n.map(v => v / ln);
    const u = [1 - N[0] * N[0], -N[0] * N[1], -N[0] * N[2]], lu = Math.hypot(...u), U = u.map(v => v / lu);
    const W = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity, rim = 0;
    for (let i = 0; i < dash.P.length; i += 3) {
      const q = [dash.P[i] - R.x, dash.P[i + 1] - R.y, dash.P[i + 2] - R.z];
      const d = q[0] * N[0] + q[1] * N[1] + q[2] * N[2], a = q[0] * U[0] + q[1] * U[1] + q[2] * U[2], b = q[0] * W[0] + q[1] * W[1] + q[2] * W[2];
      if (Math.abs(d) > 0.03 || Math.hypot(a, b) < 0.2 || Math.hypot(a, b) > 0.34) continue;
      rim++; u0 = Math.min(u0, a); u1 = Math.max(u1, a); w0 = Math.min(w0, b); w1 = Math.max(w1, b);
    }
    expect(rim).toBeGreaterThan(500);
    expect(Math.hypot((u0 + u1) / 2, (w0 + w1) / 2)).toBeLessThan(0.02); // the ring centre constant is the rim's centre
    expect((u1 - u0) / 2).toBeCloseTo(R.rimOuter, 1);
    // the seat: its cushion top and the headrest face
    const sb = bbox(seat.P);
    expect(sb.mx[1]).toBeCloseTo(SEAT_MODEL.h, 2);
    let cushion = 0, head = -Infinity;
    for (let i = 0; i < seat.P.length; i += 3) {
      const x = seat.P[i], y = seat.P[i + 1], z = seat.P[i + 2];
      if (Math.abs(x) < 0.15 && z > 0 && z < 0.2) cushion = Math.max(cushion, y); // the seat pan, ahead of the backrest
      if (Math.abs(x) < 0.12 && y > 0.95 && y < 1.08) head = Math.max(head, z); // the headrest face (front +Z)
    }
    expect(cushion).toBeCloseTo(SEAT_MODEL.cushion, 1);
    expect(head).toBeCloseTo(SEAT_MODEL.headrestZ, 1);
  });

  it('the steering wheel is in front of the driver\'s eye: its rim centre (on the placed mesh) within 0.1 m of the eye\'s x', () => {
    expect(L.dash.rotY).toBe(0); // (the dash's +Z face — gauges / wheel — toward the driver: unrotated)
    expect(L.dash.scale).toBeCloseTo((S.interior.x1 - S.interior.x0) / DASH_MODEL.w, 9); // the cabin width, uniformly
    const c = posePoint(L.dash, DASH_MODEL.ring.x, DASH_MODEL.ring.y, DASH_MODEL.ring.z);
    expect(Math.abs(c.x - E.x)).toBeLessThan(0.1);
    expect(c.x).toBeCloseTo(L.wheel.x, 9);
    expect(c.y).toBeCloseTo(S.wheelCentre.y, 6);
    expect(c.z).toBeCloseTo(S.wheelCentre.z, 6);
    // the placed rim's own extent around the eye's x (the mesh, not the constant)
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < dashP.length; i += 3) {
      const dx = dashP[i] - c.x, dy = dashP[i + 1] - c.y, dz = dashP[i + 2] - c.z;
      const d = dx * L.wheel.nx + dy * L.wheel.ny + dz * L.wheel.nz, r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - d * d));
      if (Math.abs(d) < 0.025 && r > L.wheel.r * 0.8 && r < L.wheel.rimOuter * 1.05) { x0 = Math.min(x0, dashP[i]); x1 = Math.max(x1, dashP[i]); }
    }
    expect(Math.abs((x0 + x1) / 2 - E.x)).toBeLessThan(0.1);
    expect(x1 - x0).toBeGreaterThan(0.36); expect(x1 - x0).toBeLessThan(0.52); // a big sports wheel (the model's proportion), not a bus's
    // ahead of the eye at a reach, its top under the eye line
    expect(E.z - c.z).toBeGreaterThan(0.35); expect(E.z - c.z).toBeLessThan(0.7);
    expect(c.y + L.wheel.rimOuter).toBeLessThan(E.y - 0.05);
  });

  it('the dash stays under the cowl -> header sight line; no ray from the eye out through the windscreen meets the cockpit first', () => {
    const cowlDrop = Math.atan2(E.y - S.cowl.y, E.z - S.cowl.z); // the windscreen's bottom edge below the eye line (rad)
    let worstLine = Infinity, wheelDrop = Infinity;
    const check = (x: number, y: number, z: number) => { if (Math.abs(x - E.x) < 0.3 && z >= S.cowl.z) worstLine = Math.min(worstLine, sightLineY(S, z) - y); };
    for (let i = 0; i < dashP.length; i += 3) {
      check(dashP[i], dashP[i + 1], dashP[i + 2]);
      if (Math.abs(dashP[i] - E.x) < 0.25) wheelDrop = Math.min(wheelDrop, Math.atan2(E.y - dashP[i + 1], E.z - dashP[i + 2]));
    }
    for (let i = 0; i < fill.P.length; i += 3) check(fill.P[i], fill.P[i + 1], fill.P[i + 2]);
    expect(worstLine).toBeGreaterThan(0.05); // under the cowl -> header line at the eye's x (in the cabin, behind the cowl)
    expect(wheelDrop - cowlDrop).toBeGreaterThan((2.5 * Math.PI) / 180); // the wheel / cluster hood well under the glass's bottom edge
    expect(bbox(dashP).mx[1]).toBeLessThan(S.cowl.y + 0.05);
    // the windscreen view: every ray that leaves through the windscreen reaches the glass before any cockpit part
    const cockpit: Mesh[] = [{P: dashP, I: dash.I}, ...seatsP.map(P => ({P, I: seat.I})), fill];
    let out = 0;
    const blocked: string[] = [];
    for (let yaw = -45; yaw <= 45; yaw += 5) for (let pitch = -12; pitch <= 20; pitch += 1) {
      const a = (yaw * Math.PI) / 180, b = (pitch * Math.PI) / 180, d: V3 = [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)], o: V3 = [E.x, E.y, E.z];
      const tGlass = hitT(glass, o, d);
      if (!(tGlass < hitT(body, o, d)) || o[2] + d[2] * tGlass > E.z - 0.3) continue; // (not out through the windscreen)
      out++;
      const tc = Math.min(...cockpit.map(m => hitT(m, o, d)));
      if (tc < tGlass) blocked.push(`yaw ${yaw} pitch ${pitch}`);
    }
    expect(out).toBeGreaterThan(200);
    expect(blocked).toEqual([]);
  });

  it('the driver seat is under the eye facing the dash (the eye 0.65-0.75 m over the cushion, the headrest just behind); the passenger\'s mirrors it', () => {
    const [d, p] = L.seats, db = bbox(seatsP[0]), pb = bbox(seatsP[1]);
    expect(Math.abs(d.x - E.x)).toBeLessThan(0.06);
    expect(p.x).toBeCloseTo(-d.x, 9); expect(p.z).toBeCloseTo(d.z, 9);
    for (const s of L.seats) expect(posePoint(s, 0, 0, 1).z).toBeLessThan(s.z); // the sitting side (model +Z) faces the dash (-Z)
    expect(E.x).toBeGreaterThan(db.mn[0]); expect(E.x).toBeLessThan(db.mx[0]);
    expect(E.z).toBeGreaterThan(db.mn[2]); expect(E.z).toBeLessThan(db.mx[2]);
    expect(E.y - L.cushionY).toBeGreaterThanOrEqual(0.65); expect(E.y - L.cushionY).toBeLessThanOrEqual(0.75);
    expect(db.mx[0]).toBeLessThan(pb.mn[0]); // two seats, apart
    expect(db.mx[1]).toBeLessThan(E.y + 0.12); // the headrest at head height (the roof is ~0.25 m above the eye)
    // nothing of the cockpit within the camera's near reach of the eye (0.05 m): the headrest face stays a hand behind it
    let near = Infinity;
    for (const P of [dashP, ...seatsP]) for (let i = 0; i < P.length; i += 3) near = Math.min(near, Math.hypot(P[i] - E.x, P[i + 1] - E.y, P[i + 2] - E.z));
    expect(near).toBeGreaterThan(0.08);
    // on the cabin floor (or on a riser that stands on it)
    expect(d.y).toBeGreaterThanOrEqual(CABIN.floorY - 1e-9);
    if (d.y > CABIN.floorY + 0.01) expect(L.fillers.filter(b => b.name.startsWith('riser') && b.y0 === CABIN.floorY && b.y1 >= d.y)).toHaveLength(2);
    // the shell's floor really is there (a ray down from under each seat meets the body at floorY)
    for (const s of L.seats) expect(1 - hitT(body, [s.x, 1, s.z], [0, -1, 0])).toBeCloseTo(CABIN.floorY, 1);
  });

  it('every part and filler lies inside the car\'s closed shell (nothing pokes through the paint)', () => {
    const outside: string[] = [];
    for (let i = 0; i < dashP.length; i += 9) if (!shellInside(dashP[i], dashP[i + 1], dashP[i + 2])) outside.push(`dash ${dashP[i].toFixed(3)},${dashP[i + 1].toFixed(3)},${dashP[i + 2].toFixed(3)}`);
    for (const P of seatsP) for (let i = 0; i < P.length; i += 9) if (!shellInside(P[i], P[i + 1], P[i + 2])) outside.push(`seat ${P[i].toFixed(3)},${P[i + 1].toFixed(3)},${P[i + 2].toFixed(3)}`);
    for (let i = 0; i < fill.P.length; i += 3) if (!shellInside(fill.P[i], Math.max(fill.P[i + 1], CABIN.floorY + 0.002), fill.P[i + 2])) outside.push(`filler ${fill.P[i].toFixed(3)},${fill.P[i + 1].toFixed(3)},${fill.P[i + 2].toFixed(3)}`);
    expect(outside).toEqual([]);
    expect(L.fillers.map(b => b.name).sort()).toEqual(['riser-left', 'riser-right', 'shelf-left', 'shelf-right', 'tunnel']);
    // the firewall's measured top really meets the shell: 1..25 mm under its inner top over its depth (no slot; the ends lowered clear of the walls)
    const F = L.firewall;
    expect(F.top).toBe(FIREWALL.top);
    expect(F.z1).toBeGreaterThan(F.z0 + 0.05);
    for (const [x, y] of F.top) {
      let gap = Infinity;
      for (let z = F.z0; z <= F.z1 + 1e-9; z += (F.z1 - F.z0) / 6) gap = Math.min(gap, hitT(body, [x, y, z], [0, 1, 0]), hitT(glass, [x, y, z], [0, 1, 0]));
      expect(gap, `firewall top at x ${x}`).toBeGreaterThan(0.001);
      expect(gap, `firewall top at x ${x}`).toBeLessThan(0.025);
    }
  });

  it('first person: a fan of rays from the eye never reaches the hollow shell past the firewall below the windscreen (no engine bay)', () => {
    const fw = L.firewall;
    const tris: number[] = []; // (the body's front part only: the rays go forward / sideways from the driver's seat)
    for (let t = 0; t < body.I.length; t += 3) if (Math.min(body.P[3 * body.I[t] + 2], body.P[3 * body.I[t + 1] + 2], body.P[3 * body.I[t + 2] + 2]) < 0.6) tris.push(body.I[t], body.I[t + 1], body.I[t + 2]);
    const front: Mesh = {P: body.P, I: tris};
    const cockpit: Mesh[] = [{P: dashP, I: dash.I}, ...seatsP.map(P => ({P, I: seat.I})), fill];
    const seen: string[] = [];
    let rays = 0;
    // a coarse fan over the whole lower view + a fine one over the band just under the windscreen's bottom edge (where a slot would show)
    const fan: [number, number][] = [];
    for (let yaw = -70; yaw <= 70; yaw += 10) for (let pitch = -60; pitch <= -4; pitch += 4) fan.push([yaw, pitch]);
    for (let yaw = -60; yaw <= 60; yaw += 6) for (let pitch = -12; pitch <= -5; pitch += 0.35) fan.push([yaw, pitch]);
    for (const [yaw, pitch] of fan) {
      const a = (yaw * Math.PI) / 180, b = (pitch * Math.PI) / 180, d: V3 = [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)], o: V3 = [E.x, E.y, E.z];
      const tShell = hitT(front, o, d), tGlass = hitT(glass, o, d), tCockpit = Math.min(...cockpit.map(m => hitT(m, o, d)));
      rays++;
      if (!(tShell < tGlass && tShell < tCockpit)) continue; // the cockpit or the glass first
      const p = o.map((v, k) => v + d[k] * tShell);
      if (p[2] < fw.z0 && p[1] < S.cowl.y - 0.05) seen.push(`yaw ${yaw} pitch ${pitch.toFixed(2)}: shell at ${p.map(v => v.toFixed(2)).join(',')}`);
    }
    expect(rays).toBeGreaterThan(600);
    expect(seen).toEqual([]);
  });
});

describe('skyways car: the cockpit view', () => {
  /** A stand-in GLTF: one mesh of the model's bounds (the runtime only clones / places it). */
  const fake = (name: string, w: number, h: number, d: number): GLTF => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), new THREE.MeshStandardMaterial());
    m.name = name;
    scene.add(m);
    return {scene} as unknown as GLTF;
  };

  it('with both parts: the dash + two seats where cockpitLayout puts them, the fillers in one plain material; no procedural pieces', () => {
    setSkywaysCarModelsForTests({car: null, dash: fake('dash', DASH_MODEL.w, DASH_MODEL.h, DASH_MODEL.d), seat: fake('seat', SEAT_MODEL.w, SEAT_MODEL.h, SEAT_MODEL.d)});
    try {
      const v = buildCarView(S);
      expect(v.cockpit.name).toBe('skyways-car-cockpit-model');
      expect(v.wheel).toBeNull();
      expect(v.cockpit.getObjectByName('skyways-car-steering')).toBeUndefined();
      const dashO = v.cockpit.getObjectByName('skyways-car-dash-model')!;
      expect(dashO.position.toArray()).toEqual([L.dash.x, L.dash.y, L.dash.z]);
      expect(dashO.scale.x).toBeCloseTo(L.dash.scale, 9);
      for (const [i, n] of ['skyways-car-seat-left', 'skyways-car-seat-right'].entries()) {
        const o = v.cockpit.getObjectByName(n)!;
        expect(o.position.toArray()).toEqual([L.seats[i].x, L.seats[i].y, L.seats[i].z]);
        expect(o.rotation.y).toBeCloseTo(Math.PI, 9);
      }
      v.group.updateMatrixWorld(true);
      const db = new THREE.Box3().setFromObject(dashO), sb = new THREE.Box3().setFromObject(v.cockpit.getObjectByName('skyways-car-seat-left')!);
      const pb = bbox(dashP), qb = bbox(seatsP[0]);
      for (let k = 0; k < 3; k++) { expect(db.min.getComponent(k)).toBeCloseTo(pb.mn[k], 2); expect(sb.max.getComponent(k)).toBeCloseTo(qb.mx[k], 2); }
      const fillO = v.cockpit.getObjectByName('skyways-car-cockpit-fill') as THREE.Mesh; // the fillers: ONE mesh, one plain material
      expect(fillO.geometry.getAttribute('position').array).toEqual(fill.P);
      expect((fillO.material as THREE.MeshStandardMaterial).map).toBeNull();
      expect((fillO.material as THREE.MeshStandardMaterial).color.getHex(THREE.SRGBColorSpace)).toBe(FILL_COLOR);
      expect(v.cockpit.children).toHaveLength(4); // dash, two seats, the fillers
      v.cockpit.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.userData.carPart).toBe('cockpit'); });
      // in a world: the cockpit casts no shadow
      const {car} = carHost();
      car.view!.cockpit.traverse(o => { if ((o as THREE.Mesh).isMesh) expect((o as THREE.Mesh).castShadow).toBe(false); });
      // a part that failed to load: the procedural cockpit (the wheel turns)
      setSkywaysCarModelsForTests({car: null, dash: fake('dash', 1, 1, 1), seat: null});
      const w = buildCarView(S);
      expect(w.cockpit.name).toBe('skyways-car-cockpit');
      expect(w.wheel).not.toBeNull();
    } finally { setSkywaysCarModelsForTests({car: null, dash: null, seat: null}); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Audio

const settle = () => new Promise(r => setTimeout(r, 40));
type Rec = Src & {stopAt?: number};
async function audio(only?: readonly (typeof CUES)[number][]) {
  const made: FakeCtx[] = [];
  const sfx = new Sfx(() => {
    const c = new FakeCtx();
    const mk = c.createBufferSource.bind(c);
    c.createBufferSource = () => { const s = mk() as Rec; s.stop = (t?: number) => { s.stopAt = t ?? c.currentTime; }; return s; };
    made.push(c);
    return c as unknown as AudioContext;
  }, fakeBank({variants: 1, only}).bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  return {sfx, ctx: made[0]};
}
const bufOf = (sfx: Sfx, cue: string) => (sfx as unknown as {bank: {pick(c: string): {buffer: unknown} | null}}).bank.pick(cue)!.buffer;

describe('Sfx: the prize car cues', () => {
  it('the clips: the car cues in the bank (idle / drive / reverse-whine loops), gains set', () => {
    for (const c of ['carIdle', 'carDrive', 'carStart', 'carReverse', 'carBrake', 'carSkid', 'carDoor'] as const) { expect(CUES as readonly string[]).toContain(c); expect(CUE_GAIN[c]).toBeGreaterThan(0); expect(CLIP_MANIFEST_SKYWAYS_CAR[c]).toHaveLength(1); }
    expect(CLIP_MANIFEST_SKYWAYS_CAR.carIdle[0].loop).toBeTruthy();
    expect(CLIP_MANIFEST_SKYWAYS_CAR.carDrive[0].loop).toBeTruthy();
    expect(CLIP_MANIFEST_SKYWAYS_CAR.carReverse[0].loop).toBeTruthy();
  });

  it('are safe without an audio context (Node / before the first gesture)', () => {
    const sfx = new Sfx(() => null as unknown as AudioContext, fakeBank().bank);
    expect(() => { sfx.carEngine(0.5, 1, {x: 0, y: 1, z: 0}, {rev: true}); sfx.stopCarEngine(); sfx.carDoor(); sfx.pause(); }).not.toThrow();
    expect(sfx.carSkid()).toBe(false);
    expect(sfx.carAudioState()).toMatchObject({engine: false, starts: 0});
  });

  it('carEngine: ONE channel (the idle + drive + reverse-whine loops) never restarted per frame; the rates rise with the rpm (drive 0.85 -> 1.6, idle 1 -> 1.35), the loops crossfade by it', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length;
    sfx.carEngine(0, 0, {x: 1, y: 0.75, z: -1.5});
    const loops = ctx.started.slice(s0) as Rec[];
    expect(loops).toHaveLength(3);
    expect(loops.map(s => s.buffer)).toEqual([bufOf(sfx, 'carIdle'), bufOf(sfx, 'carDrive'), bufOf(sfx, 'carReverse')]);
    for (const s of loops) { expect(s.loop).toBe(true); expect(s.stopAt).toBeUndefined(); }
    // from silence: the loops' gains start at 0 and only targets move
    const idleState = sfx.carAudioState();
    expect(idleState.engine).toBe(true);
    expect(idleState.rate).toBeCloseTo(CAR_AUDIO.driveRate[0], 6);
    expect(idleState.idleRate).toBeCloseTo(CAR_AUDIO.idleRate[0], 6); // (round 2: the idle never plays below 1x)
    expect(idleState.reverse).toBe(0);
    expect(idleState.idle).toBeCloseTo(CUE_GAIN.carIdle, 6);
    expect(idleState.drive).toBeCloseTo(0, 6);
    let last = idleState;
    for (let i = 1; i <= 60; i++) {
      ctx.currentTime += 1 / 60;
      sfx.carEngine(i / 60, 1, {x: 1, y: 0.75, z: -1.5 - i * 0.2});
      const st = sfx.carAudioState();
      expect(st.rate).toBeGreaterThanOrEqual(last.rate - 1e-9);
      expect(st.drive).toBeGreaterThanOrEqual(last.drive - 1e-9);
      expect(st.idle).toBeLessThanOrEqual(last.idle + 1e-9);
      last = st;
    }
    expect(ctx.started.length).toBe(s0 + 3); // never restarted
    expect(last.rate).toBeCloseTo(CAR_AUDIO.driveRate[1], 2); // (a target moves only by more than CAR_AUDIO.eps)
    expect(last.drive).toBeCloseTo(CUE_GAIN.carDrive, 2);
    expect(last.idle).toBeLessThan(CUE_GAIN.carIdle * 0.4);
    expect((loops[1].playbackRate as unknown as {value: number}).value).toBeCloseTo(last.rate, 9); // (the fake param takes the target)
    // back to rest, off the pedal: idle again
    ctx.currentTime += 1;
    sfx.carEngine(0, 0);
    expect(sfx.carAudioState()).toMatchObject({rate: CAR_AUDIO.driveRate[0], drive: 0});
    expect(sfx.carAudioState().starts).toBe(1);
    expect(ctx.oscillatorCalls).toBe(0);
  });

  it('rev (getting in) without an engine-start clip: a short blip over idle that decays; stopCarEngine / pause / a new world fade it out and release it', async () => {
    const {sfx, ctx} = await audio(CUES.filter(c => c !== 'carStart')); // (round 2: with the clip the start one-shot plays — skyways-car-audio.test.ts)
    const s0 = ctx.started.length;
    sfx.carEngine(0, 0, undefined, {rev: true});
    const blip = sfx.carAudioState();
    expect(blip.revs).toBe(1);
    expect(blip.startCues).toBe(0);
    expect(blip.rate).toBeGreaterThan(CAR_AUDIO.driveRate[0] + 0.2);
    expect(blip.drive).toBeGreaterThan(0.2);
    ctx.currentTime += CAR_AUDIO.rev.s / 2;
    sfx.carEngine(0, 0);
    expect(sfx.carAudioState().rate).toBeLessThan(blip.rate);
    ctx.currentTime += CAR_AUDIO.rev.s;
    sfx.carEngine(0, 0);
    expect(sfx.carAudioState().rate).toBeCloseTo(CAR_AUDIO.driveRate[0], 6);
    const loops = ctx.started.slice(s0) as Rec[];
    sfx.stopCarEngine();
    expect(sfx.carAudioState()).toMatchObject({engine: false, stops: 1});
    for (const s of loops) expect(s.stopAt! - ctx.currentTime).toBeLessThanOrEqual(CAR_AUDIO.stopFade + 0.06);
    sfx.stopCarEngine(); // (idempotent)
    expect(sfx.carAudioState().stops).toBe(1);
    // pause: stopped at once, nothing starts while paused; resumed: a fresh channel (no rev)
    sfx.carEngine(0.3, 1);
    expect(sfx.carAudioState().engine).toBe(true);
    sfx.pause();
    expect(sfx.carAudioState().engine).toBe(false);
    sfx.carEngine(0.3, 1);
    expect(sfx.carAudioState().engine).toBe(false);
    sfx.resume();
    sfx.carEngine(0.3, 1);
    expect(sfx.carAudioState()).toMatchObject({engine: true, revs: 1, starts: 3});
    sfx.setWorld({occlusion: null}); // a new world
    expect(sfx.carAudioState().engine).toBe(false);
  });

  it('carSkid: one take at most every skid.minGapS; carDoor: one take per call', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length;
    expect(sfx.carSkid({x: 0, y: 0.3, z: 0})).toBe(true);
    expect(sfx.carSkid({x: 0, y: 0.3, z: 0})).toBe(false);
    ctx.currentTime += CAR_AUDIO.skid.minGapS / 2;
    expect(sfx.carSkid()).toBe(false);
    ctx.currentTime += CAR_AUDIO.skid.minGapS;
    expect(sfx.carSkid()).toBe(true);
    sfx.carDoor({x: -1, y: 0.8, z: 0});
    sfx.carDoor();
    const played = ctx.started.slice(s0) as Rec[];
    expect(played.map(s => s.buffer)).toEqual([bufOf(sfx, 'carSkid'), bufOf(sfx, 'carSkid'), bufOf(sfx, 'carDoor'), bufOf(sfx, 'carDoor')]);
    for (const s of played) expect(s.loop).toBe(false);
    expect(sfx.carAudioState()).toMatchObject({skids: 2, doors: 2});
  });
});

describe('skyways car: the audio wiring', () => {
  const enter = (h: CarTestHost, car: SkywaysCar) => {
    const b = car.body!, d = carToWorld(b.x, b.z, b.yaw, S.exits.left.x, S.exits.left.z), door = carToWorld(b.x, b.z, b.yaw, -(S.width / 2 - 0.05), S.exits.left.z);
    h.player.place(d.x, d.z, 0, b.y);
    frame(h, car);
    const P = h.player, dx = door.x - P.x, dy = b.y + 0.9 - P.eye, dz = door.z - P.z;
    P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    frame(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(true);
  };
  const count = (h: CarTestHost, c: string) => h.sfxCalls.filter(x => x === c).length;

  it('getting in: the door, the engine starts (rev) and follows the speed / throttle every frame; getting out: the door, the engine stops', () => {
    const {h, car} = carHost();
    h.sfxCalls.length = 0;
    enter(h, car);
    expect(h.sfxCalls.slice(0, 2)).toEqual(['door', 'engine:start']);
    run(h, car, 0.5);
    expect(h.engineLog.length).toBeGreaterThanOrEqual(29);
    expect(h.engineLog.every(e => e.k === 0 && e.th === 0)).toBe(true); // idling at rest
    h.keys.held.add('KeyW');
    run(h, car, 1.5);
    const drive = h.engineLog.slice(-10);
    expect(drive.every(e => e.th === 1)).toBe(true);
    expect(drive[9].k).toBeCloseTo(car.body!.v / CAR_PHYS.forwardMax, 6);
    expect(drive[9].k).toBeGreaterThan(drive[0].k);
    h.keys.held.clear();
    h.keys.held.add('KeyS'); // braking (the pedal against the travel): no throttle
    frame(h, car);
    expect(h.engineLog.at(-1)!.th).toBe(0);
    run(h, car, 3, () => car.body!.v <= 0);
    h.keys.held.clear();
    run(h, car, 0.3);
    const n = h.engineLog.length;
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    expect(h.sfxCalls.slice(-2)).toEqual(['door', 'engine:stop']);
    run(h, car, 0.5);
    expect(h.engineLog.length).toBe(n); // an empty car makes no engine sound
    expect(count(h, 'door')).toBe(2);
  });

  it('death, a state change and a teardown stop the engine; a pause keeps the driver (Sfx.pause silences it itself)', () => {
    const {h, car} = carHost();
    enter(h, car);
    h.player.alive = false;
    frame(h, car);
    expect(h.sfxCalls.at(-1)).toBe('engine:stop');
    h.player.alive = true;
    enter(h, car);
    const stops = count(h, 'engine:stop');
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('paused', 'playing');
    expect(count(h, 'engine:stop')).toBe(stops);
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('title', 'paused');
    expect(count(h, 'engine:stop')).toBe(stops + 1);
    expect(car.driving).toBe(false);
    enter(h, car);
    teardown(h);
    expect(count(h, 'engine:stop')).toBeGreaterThanOrEqual(stops + 2);
    expect(car.driving).toBe(false);
  });

  it('the skid: a hard brake or the handbrake begun above skidSpeed — once per edge, at most every skidEvery s; never slow', () => {
    const {h, car} = carHost({spawn: {x: 15, z: 27}});
    enter(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 3, () => car.body!.v > CAR_RT.skidSpeed + 4);
    expect(car.body!.v).toBeGreaterThan(CAR_RT.skidSpeed);
    expect(count(h, 'skid')).toBe(0); // accelerating: no skid
    h.keys.held.delete('KeyW');
    h.keys.held.add('KeyS'); // hard brake at speed
    frame(h, car);
    expect(count(h, 'skid')).toBe(1);
    run(h, car, 0.15); // still braking: the same edge
    expect(count(h, 'skid')).toBe(1);
    h.keys.held.delete('KeyS');
    frame(h, car);
    h.keys.held.add('Space'); // the handbrake again at once (still fast): rate-limited
    frame(h, car);
    expect(car.body!.v).toBeGreaterThan(CAR_RT.skidSpeed);
    expect(count(h, 'skid')).toBe(1);
    h.keys.held.clear();
    run(h, car, 3, () => car.body!.v < CAR_RT.skidSpeed - 1);
    h.keys.held.add('Space'); // slow: no skid
    frame(h, car);
    expect(count(h, 'skid')).toBe(1);
  });
});
