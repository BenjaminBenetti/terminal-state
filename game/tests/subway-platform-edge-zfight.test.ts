// Task studio-cosplay-general-20261108-225231-01 (lane GENERAL; user: "Subway platform edge z-fighting."): the platform edge lip
// (world/builder.ts, 'platformFace' trim boxes along every track-side platform edge) was a box sunk flush INSIDE the platform:
// its top lay exactly on the safety-edge floor strip (y = platform floor) and its front exactly on the platform face wall over
// the track bed (z = edge), so both visible faces were coplanar duplicates of other surfaces — z-fighting along every edge.
// The lip now stands a few mm proud of both (world/platformEdgeLip.ts). This test builds real stations (CPU, no browser) and
// scans the built geometry along every platform edge for overlapping parallel surfaces closer than the chosen epsilon.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {levelFixture} from './helpers/levelRenderFixture';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL} from '../src/gen/grid';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {levelOf, stationLevels} from '../src/world/levelGeometry';
import {PLATFORM_LIP, platformLipBoxes} from '../src/world/platformEdgeLip';

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

/** Minimum separation (m) between overlapping parallel opaque surfaces along a platform edge. */
const MIN_SEP = 0.0015;

type V2 = [number, number];
interface Tri { mesh: string; mat: string; plane: number; pts: V2[] }

/** Signed area of a 2D polygon. */
const area2 = (p: V2[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
/** Convex polygon clip (Sutherland-Hodgman): `subject` against convex `clip` (any winding). */
function clipPoly(subject: V2[], clip: V2[]): V2[] {
  const ccw = area2(clip) > 0;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p: V2) => { const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); return ccw ? c : -c; };
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out;
}
const overlapArea = (a: V2[], b: V2[]) => Math.abs(area2(clipPoly(a, b)));

interface Edge { x0: number; x1: number; z: number; y: number; dir: 1 | -1 }

/** Track-side edges of the flat platforms (the builder's safety-edge rule): dir = +1 when the bed lies at +z. */
function platformEdges(layout: StationLayout): Edge[] {
  const out: Edge[] = [];
  const levels = stationLevels(layout);
  for (const id of layout.platforms) {
    const a = layout.areas[id];
    const g = (levels[levelOf(a)] ?? levels[0]).grid;
    const y = g.floorOf(g.idx(a.x, a.y));
    const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL;
    if (a.edge !== 'S') out.push({x0, x1, z: a.y * CELL, y, dir: -1});
    if (a.edge === 'S' || a.edge === 'NS') out.push({x0, x1, z: (a.y + a.h) * CELL, y, dir: 1});
  }
  return out;
}

/** Opaque, non-decal triangles of the built world within `band` m of an edge: tops (normal +y) and faces toward the bed. */
function edgeTriangles(world: ReturnType<typeof buildWorld>, mats: WorldMaterials, edges: Edge[], band = 0.6) {
  const names = new Map<THREE.Material, string>();
  for (const k of ['platformSlab', 'safetyEdge', 'platformFace', 'terrazzo', 'concrete', 'ballast', 'tunnel', 'steel', 'rail', 'coverboard'] as const) names.set(mats.get(k), k);
  const tops: Tri[][] = edges.map(() => []), fronts: Tri[][] = edges.map(() => []);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  world.group.updateMatrixWorld(true);
  world.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (mat.polygonOffset || mat.transparent || !mat.visible || !m.visible) return; // decals are offset by design
    const pos = m.geometry.attributes.position as THREE.BufferAttribute, idx = m.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const len = n.length();
      if (len < 1e-9) continue;
      n.divideScalar(len);
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
      edges.forEach((E, k) => {
        if (cx < E.x0 - 0.2 || cx > E.x1 + 0.2 || Math.abs(cz - E.z) > band || cy < E.y - 0.5 || cy > E.y + 0.1) return;
        const tri = (plane: number, pts: V2[]): Tri => ({mesh: m.name, mat: names.get(mat) ?? mat.name ?? mat.type, plane, pts});
        if (n.y > 0.999) tops[k].push(tri(cy, [[a.x, a.z], [b.x, b.z], [c.x, c.z]]));
        else if (n.z * E.dir > 0.999 && Math.abs(cz - E.z) < 0.05) fronts[k].push(tri(cz, [[a.x, a.y], [b.x, b.y], [c.x, c.y]]));
      });
    }
  });
  return {tops, fronts};
}

/** Overlapping parallel triangle pairs of DIFFERENT meshes closer than MIN_SEP (coplanar duplicates). */
function closePairs(list: Tri[]): {a: Tri; b: Tri; sep: number; area: number}[] {
  const out: {a: Tri; b: Tri; sep: number; area: number}[] = [];
  const sorted = [...list].sort((p, q) => p.plane - q.plane);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].plane - sorted[i].plane < MIN_SEP; j++) {
      const A = sorted[i], B = sorted[j];
      if (A.mesh === B.mesh && A.mat === B.mat) continue; // one surface's own adjacent triangles
      const ar = overlapArea(A.pts, B.pts);
      if (ar > 1e-6) out.push({a: A, b: B, sep: B.plane - A.plane, area: ar});
    }
  }
  return out;
}

function build(layout: StationLayout) {
  const un = installCanvasShim(false);
  try {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    return {mats, world: buildWorld(layout, mats, {})};
  } finally { un(); }
}

const describeRow = (p: {a: Tri; b: Tri; sep: number; area: number}) => `${p.a.mat}@${p.a.mesh} vs ${p.b.mat}@${p.b.mesh}: sep ${p.sep.toFixed(4)} m over ${p.area.toFixed(3)} m2`;

describe('Subway platform edge: no coplanar / overlapping surfaces (z-fighting)', () => {
  it('the edge lip stands proud of the platform floor and the platform face by the chosen epsilon', () => {
    expect(PLATFORM_LIP.rise).toBeGreaterThanOrEqual(MIN_SEP);
    expect(PLATFORM_LIP.proud).toBeGreaterThanOrEqual(MIN_SEP);
    // Thin enough not to read as a step or reach the trains (the bed's nearest track runs 2 m from the edge).
    expect(PLATFORM_LIP.rise).toBeLessThanOrEqual(0.004);
    expect(PLATFORM_LIP.proud).toBeLessThanOrEqual(0.005);
    // The box rule itself, for a south-edge and a north-edge platform.
    const f0 = 0.25;
    for (const edge of ['N', 'S', 'NS'] as const) {
      const boxes = platformLipBoxes({x: 4, y: 6, w: 8, h: 10, edge}, f0);
      expect(boxes.length).toBeGreaterThan(0);
      for (const b of boxes) {
        const top = b.cy + b.sy / 2, bottom = b.cy - b.sy / 2;
        expect(top - f0).toBeCloseTo(PLATFORM_LIP.rise, 9);
        expect(bottom).toBeCloseTo(f0 - PLATFORM_LIP.height, 9);
        const zn = 6 * CELL, zs = 16 * CELL;
        const outer = b.dir > 0 ? b.cz + b.sz / 2 : b.cz - b.sz / 2, inner = b.dir > 0 ? b.cz - b.sz / 2 : b.cz + b.sz / 2;
        const ez = b.dir > 0 ? zs : zn;
        expect((outer - ez) * b.dir).toBeCloseTo(PLATFORM_LIP.proud, 9);
        expect((ez - inner) * b.dir).toBeCloseTo(PLATFORM_LIP.depth, 9);
      }
    }
  });

  // strip: flat platforms get the safety-edge strip (side platforms); island platforms with stair wells keep the generic floor
  // (terrazzo) up to the edge (builder.ts flat rule, unchanged) — both floors met the old flush lip.
  const cases: [string, () => StationLayout, boolean][] = [
    ['fixture (S + N platforms, decks above)', () => levelFixture().layout, true],
    ['station seed 1 (side platforms N + S)', () => generateStation(1), true],
    ['station seed 9001 (island platform, NS)', () => generateStation(9001), false],
  ];
  for (const [label, make, strip] of cases) {
    it(`${label}: tops and bed-side faces along every edge keep >= ${MIN_SEP * 1000} mm between overlapping surfaces`, () => {
      const layout = make();
      const {mats, world} = build(layout);
      const edges = platformEdges(layout);
      expect(edges.length).toBeGreaterThan(0);
      const {tops, fronts} = edgeTriangles(world, mats, edges);
      let lipTops = 0, lipFronts = 0, stripTops = 0, floorTops = 0, faceFronts = 0;
      const bad: string[] = [];
      edges.forEach((E, k) => {
        for (const p of closePairs(tops[k])) bad.push(`top z ${E.z}: ${describeRow(p)}`);
        for (const p of closePairs(fronts[k])) bad.push(`face z ${E.z}: ${describeRow(p)}`);
      });
      expect(bad.slice(0, 12), `${bad.length} coplanar overlaps`).toEqual([]);
      edges.forEach((E, k) => {
        for (const t of tops[k]) {
          if (t.mat === 'platformFace' && t.mesh.startsWith('trim-')) { lipTops++; expect(t.plane - E.y, 'lip top above the floor').toBeCloseTo(PLATFORM_LIP.rise, 5); }
          if (t.mat === 'safetyEdge') { stripTops++; expect(t.plane).toBeCloseTo(E.y, 5); }
          if (t.mesh.startsWith('arch-') && Math.abs(t.plane - E.y) < 1e-5 && Math.abs((t.pts[0][1] + t.pts[1][1] + t.pts[2][1]) / 3 - E.z) < 0.5) floorTops++;
        }
        for (const t of fronts[k]) {
          if (t.mat === 'platformFace' && t.mesh.startsWith('trim-')) { lipFronts++; expect((t.plane - E.z) * E.dir, 'lip front proud of the face').toBeCloseTo(PLATFORM_LIP.proud, 5); }
          if (t.mat === 'platformFace' && t.mesh.startsWith('arch-')) { faceFronts++; expect(t.plane).toBeCloseTo(E.z, 5); }
        }
      });
      // The scan really saw the lip, the safety strip and the platform face (both visible lip faces, every edge).
      expect(lipTops).toBeGreaterThan(0);
      expect(lipFronts).toBeGreaterThan(0);
      expect(floorTops).toBeGreaterThan(0);
      if (strip) expect(stripTops).toBeGreaterThan(0);
      expect(faceFronts).toBeGreaterThan(0);
    });
  }
});
