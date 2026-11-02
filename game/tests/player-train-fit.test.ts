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
import {TrainMaterials, buildTrainView, type TrainView} from '../src/world/playerTrainView';

installCanvasShim(false);

let view: TrainView;
let shell: THREE.Mesh[];
beforeAll(async () => {
  const models: {shell: GLTF; door: GLTF; console: GLTF} = {shell: await loadStripped(S.models.shell.url), door: await loadStripped(S.models.doorLeaf.url), console: await loadStripped(S.models.console.url)};
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
