// Task studio-beta-office-elevator-visibility-20261104-063115-01 (user: "When leaving the elevator on the office level, if you stand
// right in the door way, the level disappears!"). The lift's doorway (the cab plane -> the landing plane) is the shaft's door wall:
// solid on every storey grid, so the grid resolver put an eye standing on the threshold on storey 0 and the storey culler hid the whole
// storey around it — the user's screenshot shows only uncullable things (lights, props, actors) left in a void. Now:
//  - world/towerRuntime.ts: the doorway strip carries the cab's storey (eyeOverride), exactly like the cab interior;
//  - world/levelCulling.ts: an eye inside a column with no open band on any storey keeps the last storey it stood on (never 0).
// Real generated Office tower + the real builder / culler (no tower runtime here, so no override: the culler's own safety net); a
// depth-tested oracle (helpers/visibleMeshes.ts) checks that no mesh of the storey you stand on that actually shows from the threshold
// is culled, while other storeys stay culled (no "render every floor"). The oracle only judges that storey: this harness has no cab /
// landing doors (the tower runtime builds them), so the bare shaft shows neighbouring storeys a real lift hides.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {visibleMeshes} from './helpers/visibleMeshes';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/station';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {LevelColumns, stationLevels} from '../src/world/levelGeometry';
import {CELL} from '../src/gen/grid';
import {CULL_LAYER} from '../src/world/levelCulling';
import {planElevator} from '../src/world/elevator';
import {gateWorld, readTowerInfo, type ElevatorInfo} from '../src/world/towerShared';
import {MOOD} from '../src/world/lights';

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const VISIBLE_DEPTH = Math.sqrt(-Math.log(0.05)) / MOOD.fogDensity;
const culledNow = (m: THREE.Object3D) => m.layers.isEnabled(CULL_LAYER) && !m.layers.test(new THREE.Layers());
const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 120);

let uninstall: () => void;
let layout: StationLayout, w: BuiltWorld, info: ElevatorInfo;
beforeAll(() => {
  uninstall = installCanvasShim(false);
  layout = LEVELS.office.generate('main', {levelSeed: 0x5ea1e55, startWeapon: 'pistol'});
  w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
  info = readTowerInfo(layout)!.elevator!;
});
afterAll(() => uninstall?.());

/** Camera at gate-local (s, l) on stop `k` (eye 1.62 m over its floor), looking out of the lift along the gate normal. */
function pose(k: number, s: number, yawTurn = 0): THREE.PerspectiveCamera {
  const g = planElevator(info).gate, stop = info.stops[k];
  const [x, z] = gateWorld(g, s, 0);
  cam.position.set(x, stop.y + 1.62, z);
  cam.rotation.set(0, Math.atan2(-g.nx, -g.nz) + yawTurn, 0); // three.js looks down -Z: yaw so -Z points along +n (outward)
  cam.updateMatrixWorld(true);
  return cam;
}

describe('Office lift threshold: the storey stays rendered on the doorway', () => {
  it('the doorway columns are solid on every storey grid (the premise), the lobby in front is open on that storey', () => {
    const g = planElevator(info).gate, cols = new LevelColumns(stationLevels(layout));
    const colOf = (x: number, z: number) => Math.floor(z / CELL) * cols.W + Math.floor(x / CELL);
    const [dx, dz] = gateWorld(g, g.depth / 2, 0), [lx, lz] = gateWorld(g, g.depth + 1.0, 0);
    expect(cols.count(colOf(dx, dz))).toBe(0);
    expect(cols.count(colOf(lx, lz))).toBeGreaterThan(0);
  });

  it('stepping from the lobby onto the threshold (both ways, looking out and along the jamb): no visible mesh of that storey is culled, other storeys stay culled', () => {
    const ks = [Math.min(5, info.stops.length - 1), Math.floor(info.stops.length / 2)];
    const bad: string[] = [];
    for (const k of ks) {
      const level = info.stops[k].levelId;
      const g = planElevator(info).gate;
      // lobby -> threshold -> lobby (s: landing side 1.0 m out, the doorway middle, just inside the landing plane)
      for (const [s, turn, label] of [[g.depth + 1.0, 0, 'lobby'], [g.depth / 2, 0, 'threshold'], [g.depth / 2, Math.PI / 2, 'threshold, along the jamb'],
        [g.depth - 0.05, -Math.PI / 2, 'landing plane, along the jamb'], [g.depth + 1.0, Math.PI, 'lobby, facing the lift']] as const) {
        const c = pose(k, s, turn);
        w.culler.update(c, true);
        if (w.culler.stats.level !== level) bad.push(`stop ${k} ${label}: eye storey ${w.culler.stats.level}, want ${level}`);
        const vis = visibleMeshes(w.group, c, 80, 45, {maxDist: VISIBLE_DEPTH, minPx: 3});
        const culled = [...vis].filter(([m]) => m.userData.level === level && culledNow(m));
        if (culled.length) bad.push(`stop ${k} ${label}: ${culled.slice(0, 4).map(([m, n]) => `${m.name} (L${m.userData.level}) ${n}px`).join(', ')}`);
        expect(w.culler.stats.culled, `${label}: not a global switch-off`).toBeGreaterThan(0);
      }
    }
    expect(bad).toEqual([]);
  });
});
