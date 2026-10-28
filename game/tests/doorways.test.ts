// Iteration 07 (Lane DW): walk-through openings stay free of bars / boards / rails / plates / props.
// Pure-data checks (clear volumes vs every decor volume, raw generation attempts, the clearance
// API for prop placement) plus a mesh-level check of the actually built three.js world in Node.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {ARCHETYPES, generateAttempt, generateStation, validateLayout, type Archetype, type StationLayout} from '../src/gen/station';
import {CELL, SOLID} from '../src/gen/grid';
import {storefrontParts} from '../src/gen/storefronts';
import {
  DOOR_CLEAR, blocksDoorway, boxOverlap, decorVolumes, doorAlongX, doorClearMask, doorClearVolumes, doorLanes, doorwayIntrusions,
  doorwaySummary, flightRailRuns, passageRails, propBlocksDoorway, signDims, wallBacked, type DoorClearVolume,
} from '../src/gen/doorways';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {P7_KINDS, p7ModelKey} from '../src/gen/props07';

const SEEDS = Array.from({length: 12}, (_, i) => (i * 2654435761 + 12345) >>> 0);
const cache = new Map<string, StationLayout>();
const gen = (seed: number, archetype?: Archetype) => {
  const key = `${seed}:${archetype ?? ''}`;
  let l = cache.get(key);
  if (!l) cache.set(key, (l = generateStation(seed, archetype ? {archetype} : {})));
  return l;
};
const PER_ARCH = ARCHETYPES.map((a, i) => gen(9001 + i * 7919, a));
const SAMPLE = () => [...SEEDS.map(s => gen(s)), ...PER_ARCH];

describe('doorway clearance (iteration 07, Lane DW)', () => {
  it('derives a clear volume for every walk-through lane; sealed storefronts have none', () => {
    for (const l of SAMPLE()) {
      const vols = doorClearVolumes(l);
      l.doors.forEach((d, i) => {
        const lanes = doorLanes(l, d);
        const mine = vols.filter(v => v.door === i);
        if (d.shopfront) {
          const sf = l.storefronts.find(s => s.unit === d.b)!;
          if (sf.shutter === 'closed') { expect(lanes).toBeNull(); expect(mine).toHaveLength(0); return; }
          if (sf.glazed) expect(lanes).toEqual([[sf.entry[0], sf.entry[1]]]);
        }
        if (d.fare) expect(mine).toHaveLength(((doorAlongX(d) ? d.w : d.h) + 1) / 3);
        else expect(mine).toHaveLength(1);
        // Iteration 08: openings on the upper / lower levels are measured on their own level grid.
        const lg = l.levels[d.level ?? l.areas[d.a].level ?? 0].grid;
        for (const v of mine) {
          const floor = lg.floorAt((v.x0 + v.x1) / 2, (v.z0 + v.z1) / 2);
          expect(v.y1 - v.y0).toBeGreaterThan(1.8); // the player (head 1.74 m) walks through every lane
          expect(v.y1).toBeLessThanOrEqual(floor + DOOR_CLEAR.height + 1e-6);
          expect(v.y1).toBeLessThanOrEqual(d.height + floor - DOOR_CLEAR.lintel + 1e-6);
          const depth = doorAlongX(d) ? v.z1 - v.z0 : v.x1 - v.x0;
          expect(depth).toBeCloseTo(CELL + 2 * DOOR_CLEAR.approach, 6);
        }
      });
      // Every kind of opening is represented somewhere in the sample.
      expect(vols.length).toBeGreaterThan(40);
    }
    const kinds = new Set(SAMPLE().flatMap(l => doorClearVolumes(l).map(v => v.kind)));
    for (const k of ['door', 'staff', 'arch', 'fare', 'shopfront']) expect(kinds.has(k as DoorClearVolume['kind'])).toBe(true);
  });

  it('no prop, sign, light, storefront part, rail or decor crosses an opening — every archetype', () => {
    const bad: string[] = [];
    for (const l of SAMPLE()) {
      for (const x of doorwayIntrusions(l)) bad.push(`${l.seed}/${l.archetype}: door ${x.door} (${x.kind}) ${x.source} ${x.ref}`);
      expect(validateLayout(l).filter(s => s.startsWith('doorway'))).toEqual([]);
    }
    expect(bad).toEqual([]);
  });

  it('raw generation attempts are already clear (validation retries hide nothing)', () => {
    const bad: string[] = [];
    let n = 0;
    for (const s of SEEDS) for (const arch of [undefined, ARCHETYPES[s % ARCHETYPES.length]]) for (const attempt of [0, 1]) {
      const l = generateAttempt(s, attempt, arch);
      if (!l) continue;
      n++;
      for (const x of doorwayIntrusions(l)) bad.push(`${s}/${l.archetype}/${attempt}: door ${x.door} (${x.kind}) ${x.source} ${x.ref}`);
    }
    expect(n).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('the checker catches bars, boards, plates and props across an opening (negative controls)', () => {
    const l = PER_ARCH[0];
    const vols = doorClearVolumes(l);
    const staff = vols.find(v => v.kind === 'staff' && !l.doors[v.door].level)!;
    const cx = (staff.x0 + staff.x1) / 2, cz = (staff.z0 + staff.z1) / 2;
    // A full-length handrail at 0.92 m across the opening (the old passage rail bug).
    const rail = staff.alongX ? {x0: staff.x0 - 2, x1: staff.x1 + 2, y0: 0.895, y1: 0.945, z0: cz - 0.025, z1: cz + 0.025} : {x0: cx - 0.025, x1: cx + 0.025, y0: 0.895, y1: 0.945, z0: staff.z0 - 2, z1: staff.z1 + 2};
    expect(boxOverlap(staff, rail)).not.toBeNull();
    // A plate floating across the top of the doorway (the old "AUTHORIZED PERSONNEL ONLY" bug).
    const probe: StationLayout = {...l, props: [...l.props], signs: [...l.signs]};
    probe.signs.push({x: cx, y: 2.0, z: cz, rot: staff.alongX ? 0 : Math.PI / 2, kind: 'service', text: 'PROBE', area: staff.a});
    // A crate dropped in the doorway.
    probe.props.push({kind: 'crate', x: cx, z: cz, y: 0, rot: 0, area: staff.a, hx: 0.31, hz: 0.22, h: 0.432, blocksSight: false, variant: 0});
    const hits = doorwayIntrusions(probe).filter(x => x.door === staff.door);
    expect(hits.map(h => h.source).sort()).toEqual(['prop', 'sign']);
    // Clearance API for prop placement: in the lane = blocked, well beside the opening = clear.
    expect(blocksDoorway(l, {x0: cx - 0.3, x1: cx + 0.3, z0: cz - 0.3, z1: cz + 0.3, y0: 0, y1: 0.8})?.door).toBe(staff.door);
    expect(propBlocksDoorway(l, cx, cz, 0.3, 0.3)?.door).toBe(staff.door);
    // Above the clear height (a high wall cabinet over the lintel) is fine.
    expect(blocksDoorway(l, {x0: cx - 0.3, x1: cx + 0.3, z0: cz - 0.3, z1: cz + 0.3, y0: staff.y1 + 0.01, y1: staff.y1 + 0.5})).toBeNull();
    const mask = doorClearMask(l);
    const d = l.doors[staff.door];
    expect(mask[l.grid.idx(d.x, d.y)]).toBe(1);
    // Every placed prop already keeps its footprint off the mask's lanes at prop height.
    for (const p of l.props) expect(propBlocksDoorway(l, p.x, p.z, p.hx, p.hz, p.y, p.h)).toBeNull();
  });

  it('passage and stair handrails run only along solid wall and stop short of every opening', () => {
    let rails = 0, passages = 0;
    for (const l of SAMPLE()) {
      const g = l.grid;
      const boxes = passageRails(l);
      rails += boxes.length;
      passages += l.areas.filter(a => a.type === 'passage').length;
      // The wall cells behind every rail piece (and 0.1 m past its ends) are solid.
      for (const b of boxes) {
        if (Math.max(b.x1 - b.x0, b.z1 - b.z0) < 0.2) continue; // bracket post
        const alongX = b.x1 - b.x0 > b.z1 - b.z0;
        const w = alongX ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2;
        const behind = Math.floor(w / CELL) + (w - Math.floor(w / CELL) * CELL < CELL / 2 ? -1 : 1);
        const s0 = (alongX ? b.x0 : b.z0) - 0.1, s1 = (alongX ? b.x1 : b.z1) + 0.1;
        for (let c = Math.floor(s0 / CELL); c <= Math.floor(s1 / CELL); c++) {
          const [x, y] = alongX ? [c, behind] : [behind, c];
          expect(g.get(x, y), `${l.seed} rail at ${alongX ? 'z' : 'x'}=${w.toFixed(2)} cell ${x},${y}`).toBe(SOLID);
        }
      }
      for (const r of g.ramps) {
        for (const run of flightRailRuns(g, r)) {
          for (let c = Math.floor(run.s0 / CELL); c <= Math.floor((run.s1 - 1e-6) / CELL); c++) {
            const cx = r.axis === 'x' ? c : run.side < 0 ? r.x - 1 : r.x + r.w, cy = r.axis === 'x' ? (run.side < 0 ? r.y - 1 : r.y + r.h) : c;
            expect(g.get(cx, cy)).toBe(SOLID);
          }
        }
        // Underpass legs keep both stair rails (their side walls are solid rock).
        expect(new Set(flightRailRuns(g, r).map(q => q.side)).size).toBe(2);
      }
    }
    // Passages keep their wall rails (two walls, brackets every 1.6 m) — openings only cut them.
    expect(rails).toBeGreaterThan(passages * 6);
  });

  it('wall signs are backed by wall — never floating in an opening or past a corner', () => {
    const SIDE = (rot: number) => (Math.abs(rot) < 1e-6 ? 'N' : Math.abs(Math.abs(rot) - Math.PI) < 1e-6 ? 'S' : rot > 0 ? 'W' : 'E') as 'N' | 'S' | 'W' | 'E';
    let checked = 0;
    for (const l of SAMPLE()) {
      for (const s of l.signs) {
        if (s.hang) continue;
        const a = l.areas[s.area];
        const side = SIDE(s.rot);
        const plane = side === 'N' ? a.y * CELL + 0.02 : side === 'S' ? (a.y + a.h) * CELL - 0.02 : side === 'W' ? a.x * CELL + 0.02 : (a.x + a.w) * CELL - 0.02;
        if (Math.abs((side === 'N' || side === 'S' ? s.z : s.x) - plane) > 1e-6) continue; // not a wall plate of its area (grille notice, trench wall, ladder plate)
        const {w, h} = signDims(s);
        const t = side === 'N' || side === 'S' ? s.x : s.z;
        // Iteration 08: plates on the upper / lower levels are backed by their own level's walls (never a light well).
        const lg = l.levels[a.level ?? 0].grid;
        expect(wallBacked(lg, a, side, t - w / 2, t + w / 2, s.y - h / 2), `${l.seed} ${s.kind} "${s.text}" at ${s.x.toFixed(2)},${s.z.toFixed(2)} level ${a.level ?? 0}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('food-unit backsplash and menu boards stop at the rear service door', () => {
    let rear = 0;
    for (const l of SAMPLE()) {
      for (const sf of l.storefronts) {
        if (sf.unit < 0 || !sf.food || sf.backDoor < 0) continue;
        const d = l.doors[sf.backDoor];
        const lane = doorClearVolumes(l).find(v => v.door === sf.backDoor)!;
        const parts = storefrontParts(l, sf).boxes;
        const steel = parts.filter(b => b.m === 'kitchenSteel');
        expect(steel.length).toBeGreaterThan(0);
        for (const b of parts) expect(boxOverlap(lane, b), `${sf.name} ${b.m}`).toBeNull();
        // The backsplash still covers the back wall beside the door.
        const along = doorAlongX(d) ? 'x' : 'z';
        const total = steel.reduce((n, b) => n + (along === 'x' ? b.x1 - b.x0 : b.z1 - b.z0), 0);
        expect(total).toBeGreaterThan(0.3);
        rear++;
      }
    }
    expect(rear).toBeGreaterThan(10);
  });

  it('decor volumes cover the renderer inputs and the QA summary is consistent', () => {
    const l = PER_ARCH[3];
    const v = decorVolumes(l);
    for (const src of ['prop', 'sign', 'light', 'storefront', 'decor', 'passageRail', 'stairRail']) expect(v.some(d => d.source === src), src).toBe(true);
    const s = doorwaySummary(l);
    expect(s.openings).toBe(l.doors.length);
    expect(s.intrusions).toEqual([]);
    expect(s.lanes.length).toBe(doorClearVolumes(l).length);
    expect(s.sealed.every(i => l.doors[i].shopfront)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Mesh-level: the actually built world (procedural props/trim/storefronts/signs, Node, no GLBs).

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

/** Triangle vs AABB (centre c, half extents h) separating-axis test (Akenine-Möller). */
function triBox(c: number[], h: number[], A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3): boolean {
  const v = [A, B, C].map(p => [p.x - c[0], p.y - c[1], p.z - c[2]]);
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(v[0][k], v[1][k], v[2][k]), hi = Math.max(v[0][k], v[1][k], v[2][k]);
    if (lo >= h[k] || hi <= -h[k]) return false;
  }
  const e = [0, 1, 2].map(i => { const p = v[i], q = v[(i + 1) % 3]; return [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; });
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const ed of e) for (const u of axes) {
    const ax = cross(u, ed);
    if (Math.abs(ax[0]) + Math.abs(ax[1]) + Math.abs(ax[2]) < 1e-12) continue;
    const p = v.map(q => dot(q, ax));
    const r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]);
    if (Math.min(...p) >= r || Math.max(...p) <= -r) return false;
  }
  const n = cross(e[0], e[1]);
  const r = h[0] * Math.abs(n[0]) + h[1] * Math.abs(n[1]) + h[2] * Math.abs(n[2]);
  return Math.abs(dot(n, v[0])) < r;
}

function p7BoxModels(): Record<string, GLTF> {
  const out: Record<string, GLTF> = {};
  for (const k of P7_KINDS) {
    const scene = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
    out[p7ModelKey(k)] = {scene} as unknown as GLTF;
  }
  return out;
}

function meshIntrusions(group: THREE.Object3D, vols: DoorClearVolume[]): string[] {
  const eps = 0.003;
  const lanes = vols.map(v => ({v, box: new THREE.Box3(new THREE.Vector3(v.x0 + eps, v.y0 + eps, v.z0 + eps), new THREE.Vector3(v.x1 - eps, v.y1 - eps, v.z1 - eps))}))
    .map(q => ({...q, c: q.box.getCenter(new THREE.Vector3()).toArray(), h: q.box.getSize(new THREE.Vector3()).multiplyScalar(0.5).toArray()}));
  const out = new Set<string>();
  const m = new THREE.Matrix4(), im = new THREE.Matrix4(), bb = new THREE.Box3(), tb = new THREE.Box3();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const P = geo.attributes.position, idx = geo.index;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? mesh as THREE.InstancedMesh : null;
    const tris = (idx ? idx.count : P.count) / 3;
    for (let i = 0; i < (inst ? inst.count : 1); i++) {
      m.copy(mesh.matrixWorld);
      if (inst) { inst.getMatrixAt(i, im); m.multiply(im); }
      bb.copy(geo.boundingBox!).applyMatrix4(m);
      const cands = lanes.filter(q => q.box.intersectsBox(bb));
      if (!cands.length) continue;
      for (let t = 0; t < tris; t++) {
        const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        A.fromBufferAttribute(P, ia).applyMatrix4(m); B.fromBufferAttribute(P, ib).applyMatrix4(m); C.fromBufferAttribute(P, ic).applyMatrix4(m);
        tb.makeEmpty().expandByPoint(A).expandByPoint(B).expandByPoint(C);
        for (const q of cands) {
          if (!q.box.intersectsBox(tb) || !triBox(q.c, q.h, A, B, C)) continue;
          out.add(`${mesh.name || mesh.type}${inst ? `#${i}` : ''} in door ${q.v.door} (${q.v.kind})`);
        }
      }
    }
  });
  return [...out];
}

describe('doorway clearance — built world meshes', () => {
  it('no rendered mesh (trim, rails, signs, storefronts, props, architecture) crosses an opening', () => {
    const uninstall = installCanvasShim(false);
    try {
      const bad: string[] = [];
      for (const l of [PER_ARCH[0], PER_ARCH[3], PER_ARCH[5]]) {
        const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
        // Iteration 07 (Lane P2): every integrated generated prop kind rendered as its full measured bbox (conservative stand-in
        // for the lazy p7 GLB: the real mesh lies inside it), incl. low-mount lifts, on-top decor and chairs.
        const world = buildWorld(l, mats, p7BoxModels());
        const vols = doorClearVolumes(l);
        for (const s of meshIntrusions(world.group, vols)) bad.push(`${l.archetype}: ${s}`);
        // Negative control: a 4 m steel bar at 0.92 m (above the opening's floor) across a staff doorway is reported.
        const v = vols.find(q => q.kind === 'staff')!;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(v.alongX ? 4 : 0.05, 0.05, v.alongX ? 0.05 : 4));
        bar.name = 'probe-bar';
        bar.position.set((v.x0 + v.x1) / 2, v.y0 - DOOR_CLEAR.floor + 0.92, (v.z0 + v.z1) / 2);
        world.group.add(bar);
        expect(meshIntrusions(world.group, vols.filter(q => q.door === v.door))).toEqual([`probe-bar in door ${v.door} (staff)`]);
      }
      expect(bad).toEqual([]);
    } finally { uninstall(); }
  });
});
