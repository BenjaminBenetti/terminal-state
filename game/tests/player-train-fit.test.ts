// Task train-window-fit-20261102-004022 (lane TRAIN): the player train's windows and seams fitted to the car body (user: "front window
// is not curved to align with the body ... all windows need to be better matched to car geometry. there is a seem between the walls and
// the roof of the subway cab"). Geometric checks on the REAL cooked GLBs (textures stripped) and the runtime view, no browser:
//  - seams: from outside, no ray through any gap in the shell ever sees into the lit car — the lining is closed and its outer face is
//    a dark backing (the cab / rear compartment / saloon, the wall-to-roof band, the roof);
//  - the lining itself is closed where wall meets ceiling (no band between them in the cab and the rear compartment).
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {PLAYER_TRAIN_SPEC as S} from '../src/world/playerTrainSpec';
import {TRAIN_GLASS, TRAIN_VIEW, TrainMaterials, buildTrainView, type TrainView} from '../src/world/playerTrainView';
import {trainColliders} from '../src/world/playerTrain';

installCanvasShim(false);

let view: TrainView;
let shell: THREE.Mesh[];
let glassModel: GLTF;
beforeAll(async () => {
  glassModel = await loadStripped(TRAIN_GLASS!.url);
  const models: {shell: GLTF; door: GLTF; console: GLTF; glass: GLTF} = {shell: await loadStripped(S.models.shell.url), door: await loadStripped(S.models.doorLeaf.url), console: await loadStripped(S.models.console.url), glass: glassModel};
  view = buildTrainView(S, new TrainMaterials(), models, {});
  view.root.updateMatrixWorld(true);
  shell = [];
  view.fixed.getObjectByName('train-shell')!.traverse(o => { if ((o as THREE.Mesh).isMesh) shell.push(o as THREE.Mesh); });
}, 120000);

/** The interior's lit faces (what a crack must never show from outside). */
const LIT = /^train-(walls|ceiling|bulkheads|floor)$/;

describe('player train fit: seams', () => {
  it('the lining layer is closed from the void side: through any crack in the skin, nothing of the lit car shows (only its dark outer face)', () => {
    // rays from the void between the lining and the skin toward the car, over the whole wall height along both sides and down onto the
    // ceiling: the first thing met is the lining's dark outer face, a window frame / glass, or a door jamb, never a lit inside face.
    // (Legit openings — the window rects and the doorways — are skipped: their sleeves / jambs / glass are tested elsewhere.)
    const rc = new THREE.Raycaster();
    const mine: THREE.Object3D[] = [];
    view.fixed.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name !== 'train-shell' && o.name.startsWith('train-')) mine.push(o); });
    const hw = S.interior.halfWidth, f = S.floorY, c = S.ceilingY;
    const inWindow = (side: number, x: number, y: number) => S.windows.side.some(w => w.side === side && w.zone !== 'nose' && x > w.x0 - 0.01 && x < w.x1 + 0.01 && y > w.y0 - 0.01 && y < w.y1 + 0.01);
    const inDoor = (side: number, x: number, y: number) => S.doors.some(d => d.side === side && x > d.x - d.width / 2 - 0.01 && x < d.x + d.width / 2 + 0.01 && y < f + d.height + 0.01);
    const leaks: string[] = [];
    let n = 0;
    for (const side of [-1, 1]) for (let x = S.interior.x0 + 0.03; x < S.interior.x1 - 0.02; x += 0.1) for (let y = f + 0.04; y < c - 0.005; y += 0.04) {
      if (inWindow(side, x, y) || inDoor(side, x, y)) continue;
      for (const dy of [0, 0.3]) {
        const o = new THREE.Vector3(x, y, side * (hw + 0.06));
        rc.set(o, new THREE.Vector3(0, dy, -side).normalize()); rc.far = 4;
        const hit = rc.intersectObjects(mine, false)[0];
        n++;
        if (hit && LIT.test(hit.object.name)) leaks.push(`side ${side} x ${x.toFixed(2)} y ${y.toFixed(2)} dy ${dy} -> ${hit.object.name}`);
      }
    }
    for (let x = S.interior.x0 + 0.03; x < S.interior.x1 - 0.02; x += 0.1) for (let z = -hw + 0.02; z < hw; z += 0.1) {
      const o = new THREE.Vector3(x, c + 0.05, z);
      rc.set(o, new THREE.Vector3(0, -1, 0)); rc.far = 4;
      const hit = rc.intersectObjects(mine, false)[0];
      n++;
      if (hit && LIT.test(hit.object.name)) leaks.push(`roof x ${x.toFixed(2)} z ${z.toFixed(2)} -> ${hit.object.name}`);
    }
    expect(n).toBeGreaterThan(5000);
    expect(leaks.slice(0, 12), `${leaks.length} of ${n} void-side rays saw into the lit car`).toEqual([]);
  });

  it('the lining is closed where the walls meet the ceiling in the cab and the rear compartment (no band, no overlap)', () => {
    const rc = new THREE.Raycaster();
    const inside: THREE.Object3D[] = [];
    view.fixed.traverse(o => { if ((o as THREE.Mesh).isMesh && /^train-(walls|ceiling|bulkheads|lining-backing|trim)$/.test(o.name)) inside.push(o); });
    const hw = S.interior.halfWidth, c = S.ceilingY;
    const regions: [string, number, number][] = [['cab', S.cab.x0 + 0.08, S.interior.x1 - 0.02], ['rear', S.interior.x0 + 0.02, S.rear!.x1 - 0.08], ['saloon', -4, 4]];
    for (const [name, x0, x1] of regions) for (const side of [-1, 1]) for (let x = x0; x <= x1; x += 0.02) {
      // aim from the middle of the compartment at points straddling the wall / ceiling edge: every ray meets a lit lining face
      for (const [dyEdge, dzEdge] of [[-0.004, 0], [0, -0.004], [-0.0015, -0.0015]]) {
        const o = new THREE.Vector3(x, S.floorY + 1.6, 0), t = new THREE.Vector3(x, c + dyEdge, side * (hw + dzEdge));
        rc.set(o, t.clone().sub(o).normalize()); rc.far = o.distanceTo(t) + 0.05;
        const hit = rc.intersectObjects(inside, false)[0];
        expect(hit && LIT.test(hit.object.name) ? 'lining' : hit ? hit.object.name : 'nothing', `${name} side ${side} x ${x.toFixed(2)} edge (${dyEdge}, ${dzEdge})`).toBe('lining');
      }
    }
  });
});

/** The shell's triangles inside a box, as a small DoubleSide mesh (fast probes). */
function shellIn(box: THREE.Box3): THREE.Mesh {
  const pos: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tb = new THREE.Box3();
  for (const m of shell) {
    const P = m.geometry.attributes.position, I = m.geometry.index;
    const n = I ? I.count : P.count;
    for (let i = 0; i < n; i += 3) {
      const ia = I ? I.getX(i) : i, ib = I ? I.getX(i + 1) : i + 1, ic = I ? I.getX(i + 2) : i + 2;
      a.fromBufferAttribute(P, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(P, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(P, ic).applyMatrix4(m.matrixWorld);
      tb.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
      if (tb.intersectsBox(box)) pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
}

describe('player train fit: the shell\'s cracks are closed (lane ASSETS, measured in the earlier probe)', () => {
  it('the platform-side wall-to-roof seam, the door heads, the +Z crescent and the roof slits: no ray finds a gap', () => {
    const rc = new THREE.Raycaster();
    const misses: string[] = [];
    const probe = (mesh: THREE.Mesh, o: THREE.Vector3, d: THREE.Vector3, far: number, tag: string) => { rc.set(o, d); rc.far = far; if (!rc.intersectObject(mesh, false).length) misses.push(tag); };
    // the seam (platform side, x -4.4 .. 6.9, y 3.00 .. 3.12) and the door-head slivers (both sides, y 2.983 .. 2.995 over each door)
    for (const side of [-1, 1] as const) {
      const band = shellIn(new THREE.Box3(new THREE.Vector3(-8.2, 2.8, side < 0 ? -1.7 : 1.1), new THREE.Vector3(8.2, 3.25, side < 0 ? -1.1 : 1.7)));
      if (side < 0) for (let x = -4.4; x <= 6.9; x += 0.1) for (let y = 3.0; y <= 3.12; y += 0.005) probe(band, new THREE.Vector3(x, y, -2.2), new THREE.Vector3(0, 0, 1), 1.0, `seam x ${x.toFixed(1)} y ${y.toFixed(3)}`);
      for (const d of S.doors.filter(q => q.side === side)) for (let x = d.x - d.width / 2 + 0.02; x < d.x + d.width / 2 - 0.02; x += 0.05) for (let y = S.floorY + d.height + 0.003; y <= 2.995; y += 0.003) {
        probe(band, new THREE.Vector3(x, y, side * 2.2), new THREE.Vector3(0, 0, -side), 1.0, `door ${d.x} side ${side} head x ${x.toFixed(2)} y ${y.toFixed(3)}`);
      }
      // the crescent above the +Z saloon window x 1.62 .. 2.75 (x 0.8 .. 3.5, y 2.85 .. 2.93)
      if (side > 0) for (let x = 0.8; x <= 3.5; x += 0.1) for (let y = 2.85; y <= 2.93; y += 0.005) probe(band, new THREE.Vector3(x, y, 2.2), new THREE.Vector3(0, 0, -1), 1.0, `crescent x ${x.toFixed(1)} y ${y.toFixed(3)}`);
    }
    // the roof over the interior (|z| <= 1.2), a few stations, fine across
    const roof = shellIn(new THREE.Box3(new THREE.Vector3(-8.2, 3.2, -1.6), new THREE.Vector3(8.2, 4.2, 1.6)));
    for (const x of [-6.03, -3.03, 0.017, 2.041, 4.013, 6.013]) for (let z = -1.2; z <= 1.2; z += 0.0025) probe(roof, new THREE.Vector3(x, 6, z), new THREE.Vector3(0, -1, 0), 3, `roof x ${x} z ${z.toFixed(4)}`);
    expect(misses.slice(0, 10), `${misses.length} rays through the shell`).toEqual([]);
  });
});

describe('player train fit: conformal window glass (lane ASSETS\' sheets + reveals)', () => {
  it('every opening uses its own conformal sheet and reveal (no flat pane / sleeve left)', () => {
    const glass = view.fixed.getObjectByName('train-glass') as THREE.Mesh, reveals = view.fixed.getObjectByName('train-reveals') as THREE.Mesh;
    const sheets = TRAIN_GLASS!.sheets.filter(q => q.kind !== 'leaf');
    expect(glass.userData.conformal).toBe(sheets.length);
    // every published window (nose corners via their wraps) has a sheet: 12 side + 6 end (4 of them wraps)
    expect(sheets.filter(q => q.kind === 'side').length).toBe(S.windows.side.filter(w => w.zone !== 'nose').length);
    expect(sheets.filter(q => q.kind === 'end').length).toBe(S.windows.end.length);
    expect(new Set(sheets.flatMap(q => (q.joined !== undefined ? [q.joined] : [])))).toEqual(new Set(S.windows.side.map((w, i) => (w.zone === 'nose' ? i : -1)).filter(i => i >= 0)));
    // the glass mesh holds exactly the sheets (no flat panes added)
    let sheetVerts = 0;
    for (const q of sheets) sheetVerts += (glassModel.scene.getObjectByName(q.node) as THREE.Mesh).geometry.attributes.position.count;
    expect(glass.geometry.attributes.position.count).toBe(sheetVerts);
    expect(reveals).toBeTruthy();
    expect((reveals.material as THREE.MeshStandardMaterial).transparent).toBe(false);
    expect((glass.material as THREE.Material).side).toBe(THREE.DoubleSide);
    // the doors' panes: the leaf sheet, one instanced draw, sliding / mirroring with the leaves (as before)
    expect(view.leafGlass!.mesh.count).toBe(S.doors.length * 2);
  });

  it('the glass follows the car body: each sheet\'s rim sits behind the remaining skin, the side sheets close to it, the curved ones curve with it', () => {
    // independent of lane ASSETS' own fit error (vs the model's original pane surface, published per sheet): from each RIM vertex (the
    // 15 mm overlap behind the gasket, outside the published opening) along the sheet's outward normal, the distance to the shell skin
    const rc = new THREE.Raycaster();
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const report: string[] = [];
    for (const q of TRAIN_GLASS!.sheets.filter(s0 => s0.kind !== 'leaf')) {
      expect(q.fitError ?? 0, `${q.node} fit error`).toBeLessThanOrEqual(0.012);
      const m = glassModel.scene.getObjectByName(q.node) as THREE.Mesh, P = m.geometry.attributes.position, N = m.geometry.attributes.normal;
      const near = shellIn(new THREE.Box3(new THREE.Vector3(...q.bounds.min).subScalar(0.2), new THREE.Vector3(...q.bounds.max).addScalar(0.2)));
      const w = q.kind === 'side' ? S.windows.side[q.window] : S.windows.end[q.window];
      const ds: number[] = [];
      let none = 0;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i);
        const rim = q.kind === 'side' ? x < (w as {x0: number}).x0 - 0.002 || x > (w as {x1: number}).x1 + 0.002 || y < w.y0 - 0.002 || y > w.y1 + 0.002 : y < w.y0 - 0.002 || y > w.y1 + 0.002;
        if (!rim) continue;
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        n.fromBufferAttribute(N, i).transformDirection(m.matrixWorld);
        rc.set(v.clone().addScaledVector(n, -0.005), n); rc.far = 0.3;
        const hit = rc.intersectObject(near, false)[0];
        if (hit) ds.push(hit.distance - 0.005); else none++;
      }
      ds.sort((a, b) => a - b);
      const median = ds[Math.floor(ds.length / 2)], max = ds[ds.length - 1];
      report.push(`${q.node} rim ${ds.length + none}: median ${median.toFixed(3)} max ${max.toFixed(3)} none ${none}`);
      expect(ds.length, `${q.node} rim samples`).toBeGreaterThan(10);
      // behind the skin everywhere (never in front of it), within 15 cm (the deepest frames); a wrap's open corner may see no skin
      expect(max, `${q.node} rim depth`).toBeLessThanOrEqual(0.15);
      expect(none, `${q.node} rim samples with no skin outward`).toBeLessThanOrEqual(q.joined !== undefined ? 3 : 0);
      // the side windows sit nearly flush with the body (the end / corner panes follow the nose's own frame depth: lane ASSETS' fit)
      if (q.kind === 'side') expect(median, `${q.node} rim median (flush with the side)`).toBeLessThanOrEqual(0.03);
      // a corner wrap is NOT flat: its depth varies round the nose (as the body does)
      if (q.kind === 'end' && q.joined !== undefined) expect(q.bounds.max[0] - q.bounds.min[0], `${q.node} curves round the nose`).toBeGreaterThan(0.08);
    }
    expect(report.length).toBe(TRAIN_GLASS!.sheets.filter(s0 => s0.kind !== 'leaf').length);
  });

  it('every window stays see-through (inside -> out, and the wrap corners from the side) with the reveals in place; shots stop on the sheets', () => {
    const rc = new THREE.Raycaster();
    const glass = view.fixed.getObjectByName('train-glass') as THREE.Mesh;
    const solid: THREE.Object3D[] = [];
    view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.trainGlass && !m.userData.highlightPrototype) solid.push(m); });
    const clear = (from: THREE.Vector3, to: THREE.Vector3, what: string) => {
      const d = to.clone().sub(from), len = d.length();
      rc.set(from, d.normalize()); rc.far = len;
      const hit = rc.intersectObjects(solid, false)[0];
      expect(hit ? `${hit.object.name} at ${hit.distance.toFixed(3)}` : null, `${what}: nothing opaque on the view`).toBeNull();
      rc.far = len;
      expect(rc.intersectObject(glass, false).length, `${what}: through the glass`).toBeGreaterThan(0);
    };
    S.windows.side.forEach((w, i) => {
      if (w.zone === 'nose') return;
      const cx = w.pocket ? (w.x0 + w.pocket.x0 - TRAIN_VIEW.pocketStopGap - TRAIN_VIEW.pocketStop) / 2 : (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
      clear(new THREE.Vector3(cx, cy, 0), new THREE.Vector3(cx, cy, w.side * 2.2), `side window ${i} (${w.zone})`);
    });
    S.windows.end.forEach((w, i) => {
      const cz = (w.z0 + w.z1) / 2, cy = (w.y0 + w.y1) / 2, from = w.end > 0 ? S.console.x - 0.5 : (S.rear!.x0 + S.rear!.x1) / 2;
      clear(new THREE.Vector3(from, Math.max(cy, S.floorY + 1.3), cz), new THREE.Vector3(w.end * 8.6, cy, cz), `end window ${i}`);
    });
    for (const q of TRAIN_GLASS!.sheets.filter(s0 => s0.joined !== undefined)) {
      // the wrap's side part from outside, beside the nose: in through the sheet to the end window's opening
      const n = S.windows.side[q.joined!], x = (Math.max(Math.abs(n.x0), Math.abs(n.x1)) - 0.05) * Math.sign(n.x0 + n.x1), y = (n.y0 + n.y1) / 2;
      const e = S.windows.end[q.window];
      clear(new THREE.Vector3(x, y, n.side * 2.4), new THREE.Vector3(x * 0.98, y, (e.z0 + e.z1) / 2), `wrap ${q.node} from the side`);
    }
    // shots: the slabs the colliders use for each sheet contain the sheet (a bullet stops on the glass, not cm in front of it)
    const col = trainColliders(S, {x: 0, z: 0, railTopY: 0, front: 1, level: 0}, null, {glass: TRAIN_GLASS});
    for (const q of TRAIN_GLASS!.sheets.filter(s0 => s0.kind !== 'leaf')) {
      const m = glassModel.scene.getObjectByName(q.node) as THREE.Mesh, P = m.geometry.attributes.position, v = new THREE.Vector3();
      const slabs = q.boxes.map(b => col.glass.find(g => Math.abs(g.x - (b.min[0] + b.max[0]) / 2) < 1e-6 && Math.abs(g.z - (b.min[2] + b.max[2]) / 2) < 1e-6 && Math.abs(g.y - b.min[1]) < 1e-6));
      expect(slabs.every(Boolean), `${q.node}: its slabs are among the colliders' glass`).toBe(true);
      let outside = 0;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        if (!q.boxes.some(b => v.x >= b.min[0] - 0.002 && v.x <= b.max[0] + 0.002 && v.y >= b.min[1] - 0.002 && v.y <= b.max[1] + 0.002 && v.z >= b.min[2] - 0.002 && v.z <= b.max[2] + 0.002)) outside++;
      }
      expect(outside, `${q.node}: vertices outside its hitscan slabs`).toBe(0);
    }
  });
});
