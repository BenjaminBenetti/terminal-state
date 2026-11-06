// Skyways lane ASSET-B: the hero PRIZE CAR runtime model (assets/models/skyways-prize-car.glb) and its measured anchors
// (src/assets/skywaysCar.generated.ts), cooked by tools/asset-pipeline/props/build-skyways-car.mjs from the user's community-supplied
// source. The game is first person only: the driver sits in the LEFT seat and must see out through the windscreen and both side
// windows, so the window triangles are a separate transparent `glass` primitive whose outline matches the hole in the opaque `body`.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {SKYWAYS_CAR as CAR} from '../src/assets/skywaysCar.generated';

const MODEL = 'assets/models/skyways-prize-car.glb', SIDECAR = 'assets/derivatives/skyways-prize-car.json';
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
type V3 = [number, number, number];
interface Part {P: Float32Array; N: Float32Array; I: Uint32Array}

const bytes = readFileSync(pub(MODEL));
const prov = JSON.parse(readFileSync(pub(SIDECAR), 'utf8'));
const doc = await new NodeIO().readBinary(new Uint8Array(bytes));
const root = doc.getRoot();
const node = (name: string) => root.listNodes().find(n => n.getName() === name);
const part = (name: string): Part => {
  const p = node(name)!.getMesh()!.listPrimitives()[0];
  return {P: p.getAttribute('POSITION')!.getArray() as Float32Array, N: p.getAttribute('NORMAL')!.getArray() as Float32Array, I: Uint32Array.from(p.getIndices()!.getArray()!)};
};
const body = part('body'), glass = part('glass');
const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
for (const {P} of [body, glass]) for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }

/** nearest hit along a ray: which part, the distance, and whether the face is seen from the outside (vertex normals point out) */
function cast(o: V3, d: V3, tmin = 1e-4): {hit: 'body' | 'glass' | null; t: number; outer: boolean} {
  let best = Infinity, hit: 'body' | 'glass' | null = null, outer = false;
  for (const [name, {P, N, I}] of [['body', body], ['glass', glass]] as const) {
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, s = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv; if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (v < 0 || u + v > 1) continue;
      const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
      if (tt > tmin && tt < best) { best = tt; hit = name; outer = (N[a] + N[b] + N[c]) * d[0] + (N[a + 1] + N[b + 1] + N[c + 1]) * d[1] + (N[a + 2] + N[b + 2] + N[c + 2]) * d[2] < 0; }
    }
  }
  return {hit, t: best, outer};
}
/** yaw 0 = forward (-Z), +90 = left (-X); pitch + up */
const dir = (yaw: number, pitch: number): V3 => { const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180; return [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)]; };
/** edges / islands with vertices welded by exact position */
function weld(parts: Part[]) {
  const key = new Map<string, number>();
  const ids = parts.map(({P}) => Int32Array.from({length: P.length / 3}, (_, v) => { const k = `${P[3 * v]},${P[3 * v + 1]},${P[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); return w; }));
  const edges = new Map<string, number>();
  const par = Int32Array.from({length: key.size}, (_, i) => i), find = (x: number) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  parts.forEach(({I}, n) => { for (let i = 0; i < I.length; i += 3) {
    const t = [ids[n][I[i]], ids[n][I[i + 1]], ids[n][I[i + 2]]];
    for (let e = 0; e < 3; e++) { const u = t[e], v = t[(e + 1) % 3], k = u < v ? `${u}_${v}` : `${v}_${u}`; edges.set(k, (edges.get(k) ?? 0) + 1); par[find(u)] = find(v); }
  } });
  let open = 0; for (const c of edges.values()) if (c === 1) open++;
  const islands = new Set<number>(); parts.forEach(({I}, n) => { for (let i = 0; i < I.length; i++) islands.add(find(ids[n][I[i]])); });
  return {open, islands: islands.size};
}

describe('Skyways prize car model (first-person drivable hero car)', () => {
  it('real size, grounded and centred, nose toward -Z', () => {
    expect(max[2] - min[2]).toBeCloseTo(4.78, 3);
    expect(max[0] - min[0]).toBeCloseTo(CAR.width, 3);
    expect(max[1] - min[1]).toBeCloseTo(CAR.height, 3);
    expect(CAR.width).toBeGreaterThan(1.85); expect(CAR.width).toBeLessThan(2.2);
    expect(CAR.height).toBeGreaterThan(1.25); expect(CAR.height).toBeLessThan(1.45);
    expect(Math.abs(min[1])).toBeLessThan(1e-5); // grounded
    expect(Math.abs(min[0] + max[0])).toBeLessThan(2e-3); // centred
    expect(Math.abs(min[2] + max[2])).toBeLessThan(2e-3);
    for (const n of root.listNodes()) expect(n.getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // baked
    // nose -Z: the front wheels, the windscreen and the steering wheel are forward (-Z); the bonnet is longer than the boot
    expect(CAR.wheels[0].z).toBeLessThan(0); expect(CAR.wheels[1].z).toBeLessThan(0);
    expect(CAR.wheels[2].z).toBeGreaterThan(0); expect(CAR.wheels[3].z).toBeGreaterThan(0);
    const isl = prov.output.glass.islands;
    expect(isl.windscreen.max[2]).toBeLessThan(0);
    expect(isl.rear.min[2]).toBeGreaterThan(0);
    expect(isl.windscreen.min[2] - min[2]).toBeGreaterThan(max[2] - isl.rear.max[2]);
    expect(CAR.wheelCentre.z).toBeLessThan(CAR.eye.z);
    expect(prov.convention).toMatch(/NOSE toward -Z/);
  });

  it('two primitives: opaque `body` with the re-encoded source maps (<= 120k tris) and transparent `glass`', () => {
    expect(root.listNodes().map(n => n.getName()).sort()).toEqual(['body', 'glass']);
    const bodyMat = node('body')!.getMesh()!.listPrimitives()[0].getMaterial()!, glassMat = node('glass')!.getMesh()!.listPrimitives()[0].getMaterial()!;
    expect(bodyMat.getName()).toBe('body');
    expect(glassMat.getName()).toBe('glass');
    expect(bodyMat.getAlphaMode()).toBe('OPAQUE');
    const tex = {base: bodyMat.getBaseColorTexture(), mr: bodyMat.getMetallicRoughnessTexture(), normal: bodyMat.getNormalTexture()};
    expect(tex.base?.getSize()).toEqual([2048, 2048]);
    expect(tex.normal?.getSize()).toEqual([2048, 2048]);
    expect(tex.mr?.getSize()).toEqual([1024, 1024]);
    for (const t of Object.values(tex)) expect(t?.getMimeType()).toBe('image/jpeg');
    // glass: transparent, low roughness, dark neutral tint, no texture
    expect(glassMat.getAlphaMode()).toBe('BLEND');
    const [r, g, b, a] = glassMat.getBaseColorFactor();
    expect(a).toBeGreaterThan(0.1); expect(a).toBeLessThan(0.6);
    expect(Math.max(r, g, b)).toBeLessThan(0.15); expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.03);
    expect(glassMat.getRoughnessFactor()).toBeLessThanOrEqual(0.1);
    expect(glassMat.getBaseColorTexture()).toBeNull();
    expect(glassMat.getDoubleSided()).toBe(true);
    // triangle budget + the generated counts
    expect(body.I.length / 3).toBe(CAR.bodyTris);
    expect(glass.I.length / 3).toBe(CAR.glassTris);
    expect(CAR.bodyTris).toBeLessThanOrEqual(120_000);
    expect(root.listExtensionsUsed()).toHaveLength(0); // plain glTF (no Draco / meshopt / KTX2)
  });

  it('the glass fills the body hole exactly (no gaps) as four windows', () => {
    const all = weld([body, glass]);
    expect(all.open).toBe(0); // body + glass welded by exact position is closed, like the source shell
    const b = weld([body]), g = weld([glass]);
    expect(b.open).toBeGreaterThan(0);
    expect(g.open).toBe(b.open); // the hole outline == the glass outline
    expect(g.islands).toBe(4); // windscreen, rear window, left and right side windows
    expect(Object.keys(prov.output.glass.islands).sort()).toEqual(['left', 'rear', 'right', 'windscreen']);
  });

  it('anchors: wheels, eye, steering wheel, exits, circles and the cabin box are consistent with the mesh', () => {
    const inside = (p: {x: number; y?: number; z: number}) => p.x > min[0] && p.x < max[0] && p.z > min[2] && p.z < max[2] && (p.y === undefined || (p.y > 0 && p.y < max[1]));
    for (const [i, w] of CAR.wheels.entries()) {
      expect(inside(w)).toBe(true);
      expect(Math.sign(w.x)).toBe(i % 2 ? 1 : -1); // [FL, FR, RL, RR]
      expect(w.r).toBeGreaterThan(0.3); expect(w.r).toBeLessThan(0.42);
      expect(w.y - w.r).toBeGreaterThanOrEqual(-1e-3); expect(w.y - w.r).toBeLessThan(0.03); // tyres on the ground
    }
    expect(CAR.wheelBase).toBeCloseTo((CAR.wheels[2].z + CAR.wheels[3].z - CAR.wheels[0].z - CAR.wheels[1].z) / 2, 2);
    expect(CAR.track).toBeCloseTo((CAR.wheels[1].x - CAR.wheels[0].x + CAR.wheels[3].x - CAR.wheels[2].x) / 2, 2);
    const box = CAR.interior, inBox = (p: {x: number; y: number; z: number}) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1 && p.z > box.z0 && p.z < box.z1;
    expect(inside({x: box.x0, y: box.y0, z: box.z0}) && inside({x: box.x1, y: box.y1, z: box.z1})).toBe(true);
    expect(inBox(CAR.eye)).toBe(true);
    expect(inBox(CAR.wheelCentre)).toBe(true);
    expect(CAR.eye.x).toBeLessThan(-0.2); // driver = LEFT seat
    expect(CAR.eye.z).toBeGreaterThan(CAR.header.z); // behind the windscreen
    expect(CAR.cowl.z).toBeLessThan(CAR.header.z);
    // seated eye ~0.25 m under the roof
    const up = cast([CAR.eye.x, CAR.eye.y, CAR.eye.z], [0, 1, 0]);
    expect(up.hit).toBe('body'); expect(up.t).toBeGreaterThan(0.18); expect(up.t).toBeLessThan(0.32);
    // exits: outside the doors (beyond the body side, on its own side), mid-door between the wheels
    for (const [side, e] of [[-1, CAR.exits.left], [1, CAR.exits.right]] as const) {
      expect(Math.sign(e.x)).toBe(side); expect(Math.abs(e.x)).toBeGreaterThan(CAR.width / 2 + 0.3);
      expect(e.z).toBeGreaterThan(CAR.wheels[0].z + 0.5); expect(e.z).toBeLessThan(CAR.wheels[2].z - 0.5);
    }
    // the circles cover every vertex below the mirrors
    expect(CAR.circles.length).toBeGreaterThanOrEqual(2); expect(CAR.circles.length).toBeLessThanOrEqual(4);
    for (const {P} of [body, glass]) for (let i = 0; i < P.length; i += 3) if (P[i + 1] <= 0.95) expect(CAR.circles.some(c => Math.hypot(P[i], P[i + 2] - c.z) <= c.r)).toBe(true);
  });

  it('first person: from the eye the driver sees out through the windscreen and both side windows', () => {
    const eye: V3 = [CAR.eye.x, CAR.eye.y, CAR.eye.z];
    for (const [yaw, pitch] of [[0, 0], [0, -6], [0, 15], [-30, 0], [90, 0], [90, -10], [50, -5], [-90, 0], [-45, -5]]) {
      const d = dir(yaw, pitch), first = cast(eye, d);
      expect(first.hit, `yaw ${yaw} pitch ${pitch}`).toBe('glass');
      const next = cast(eye, d, first.t + 1e-4); // past the glass: the outside world or an outer body face, never the hollow shell
      expect(next.hit === null || next.hit === 'glass' || next.outer, `yaw ${yaw} pitch ${pitch} past the glass`).toBe(true);
    }
    expect(prov.glassClassification.proof.lookThroughFromEye.intoShell).toBe(0);
  });

  it('provenance (community source, no licence claim) and the release allowlist bind these exact bytes', () => {
    expect(CAR.url).toBe(MODEL);
    expect(prov).toMatchObject({id: 'skyways-prize-car', output: {url: MODEL, bytes: bytes.length, sha256: sha(bytes), triangles: CAR.bodyTris + CAR.glassTris}});
    expect(prov.source.licence).toMatch(/community-supplied source via the user .*no license or authorship claim/);
    expect(prov.source.triangles).toBeGreaterThan(1_000_000);
    expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=/i);
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const side = readFileSync(pub(SIDECAR));
    expect(allow.get(MODEL)).toEqual({path: MODEL, bytes: bytes.length, sha256: sha(bytes)});
    expect(allow.get(SIDECAR)).toEqual({path: SIDECAR, bytes: side.length, sha256: sha(side)});
  });
});
