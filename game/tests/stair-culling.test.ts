// Iteration 12 (ARCH), user feedback #2: "Right when changing levels, like right at the moment where you get to
// the bottom of the stairs the geometry often disappears! i.e. gets culled. walking forward down the final step
// makes that level appear."
//
// Root cause: a stair run (flights + intermediate landings + lead) is carved identically into the two level grids it
// joins, so LevelColumns deduplicates it into ONE band owned by the main level. The culler took the camera's level
// from that band, so on the whole run the camera was "main": at the bottom of a run down to the lower level (and the
// top of a run up to the upper level) the destination level was culled unless one of the few mid-run portal columns
// was in the frustum - and those are behind you once you face off the last step.
//
// These tests walk a camera (eye 1.62 m over the treads / floor, never closer than the player's 0.3 m radius to a
// wall) along every stair link of generated stations, bottom -> top and back, in small steps around both ends, and
// compare the culler with a depth-buffered visibility oracle (tests/helpers/visibleMeshes.ts): no mesh that shows at
// least 5 % of its own colour through the fog may sit on the cull layer.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {visibleMeshes} from './helpers/visibleMeshes';
import {levelFixture, FIX} from './helpers/levelRenderFixture';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR} from '../src/gen/grid';
import type {LevelLink} from '../src/gen/levels';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {stationLevels, stationLinks} from '../src/world/levelGeometry';
import {CULL_LAYER, fogCullDistance, sharedColumn} from '../src/world/levelCulling';
import {MOOD} from '../src/world/lights';

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const EYE = 1.62, BODY = 0.3;
/** Fog view depth at which a surface still shows 5 % of its own colour (FogExp2). */
const VISIBLE_DEPTH = Math.sqrt(-Math.log(0.05)) / MOOD.fogDensity;
const culledNow = (m: THREE.Object3D) => m.layers.isEnabled(CULL_LAYER) && !m.layers.test(new THREE.Layers());

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; s: number; label: string }

/**
 * Camera poses along a link: from 2.5 m before its bottom stand point to 2.5 m past its top one, feet on the treads
 * (stepAt) of whichever of the two grids continues the walk, every 0.25 m within 3.5 m of either end (the transition)
 * and every 0.5 m between; facing up / down the run, level and pitched along the slope.
 */
function walkPoses(l: StationLayout, k: LevelLink): Pose[] {
  const levels = stationLevels(l);
  const A = k.bottom, B = k.top;
  const len = Math.hypot(B.x - A.x, B.z - A.z), dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
  const grids = [levels[k.lower].grid, levels[k.upper].grid];
  const W = grids[0].w;
  const out: Pose[] = [];
  let feet = A.y;
  for (let s = -2.5; s <= len + 2.5 + 1e-6; s += s < 3.5 || s > len - 3.5 ? 0.25 : 0.5) {
    const x = A.x + dx * s, z = A.z + dz * s;
    let best = NaN;
    for (const g of grids) {
      if (g.cells[Math.floor(z / CELL) * W + Math.floor(x / CELL)] !== FLOOR) continue;
      const f = g.stepAt(x, z);
      if (Number.isNaN(best) || Math.abs(f - feet) < Math.abs(best - feet)) best = f;
    }
    if (Number.isNaN(best) || Math.abs(best - feet) > 0.6) continue;
    // The player's body keeps the eye BODY m from any wall.
    const clear = [[BODY, 0], [-BODY, 0], [0, BODY], [0, -BODY], [0.21, 0.21], [-0.21, 0.21], [0.21, -0.21], [-0.21, -0.21]].every(([ox, oz]) => {
      const i = Math.floor((z + oz) / CELL) * W + Math.floor((x + ox) / CELL);
      return grids.some(g => g.cells[i] === FLOOR && Math.abs(g.stepAt(x + ox, z + oz) - best) < 0.6);
    });
    if (!clear) continue;
    feet = best;
    const up = Math.atan2(-dx, -dz);
    for (const [yaw, pitch, dir] of [[up, 0, 'up'], [up, 0.35, 'up'], [up + Math.PI, 0, 'down'], [up + Math.PI, -0.35, 'down']] as const) {
      out.push({x, y: feet + EYE, z, yaw, pitch, s, label: `link ${k.id} L${k.lower}->L${k.upper} s ${s.toFixed(2)}/${len.toFixed(1)} feet ${feet.toFixed(2)} facing ${dir} pitch ${pitch}`});
    }
  }
  return out;
}

const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
cam.rotation.order = 'YXZ';
function place(p: {x: number; y: number; z: number; yaw: number; pitch: number}): THREE.PerspectiveCamera {
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, p.yaw, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Walk every stair link of a built station; returns the poses where a visible mesh was culled. */
function walkStation(l: StationLayout, w: BuiltWorld, links: LevelLink[]): {poses: number; bad: string[]; onRun: number} {
  w.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
  const bad: string[] = [];
  let poses = 0, onRun = 0;
  for (const k of links) {
    for (const p of walkPoses(l, k)) {
      w.culler.update(place(p), true);
      poses++;
      const st = w.culler.stats.levels;
      if (st.includes(k.lower) && st.includes(k.upper)) onRun++;
      const vis = visibleMeshes(w.group, cam, 80, 45, {maxDist: VISIBLE_DEPTH, minPx: 3});
      const culled = [...vis].filter(([m]) => culledNow(m));
      if (culled.length) bad.push(`${p.label}: ${culled.map(([m, n]) => `${m.name} (L${m.userData.level}) ${n}px`).join(', ')}`);
    }
  }
  return {poses, bad, onRun};
}

/** One up-run and one down-run per station (the others are mirror copies in other cores). */
function sampleLinks(l: StationLayout): LevelLink[] {
  const ls = stationLinks(l).filter(k => k.kind === 'stairs');
  const up = ls.find(k => k.lower === 0), down = ls.find(k => k.upper === 0);
  return [up, down].filter((k): k is LevelLink => !!k);
}

describe('stair transitions never cull the level being entered or left (user feedback #2)', () => {
  it('fixture: shared stair-run columns are portals; on the run both levels are current; culling still works elsewhere', () => {
    const un = installCanvasShim(false);
    try {
      const {layout, rampDown} = levelFixture();
      const w = buildWorld(layout, mats(), {});
      const levels = stationLevels(layout);
      // The down flight (main + lower) is carved identically into both grids: shared columns.
      const i = rampDown.y * levels[0].grid.w + rampDown.x + 2;
      expect(sharedColumn(levels[0].grid, levels[2].grid, i)).toBe(true);
      expect(sharedColumn(levels[0].grid, levels[1].grid, i)).toBe(false);
      // Standing on the down flight near its bottom, facing off the last step: main AND lower are current.
      const sb = Math.min(rampDown.s0, rampDown.s1) + 0.4, zc = (rampDown.y + rampDown.h / 2) * CELL;
      const g0 = levels[0].grid;
      w.culler.update(place({x: sb, y: g0.stepAt(sb, zc) + EYE, z: zc, yaw: Math.PI / 2, pitch: 0}), true);
      expect(w.culler.stats.levels.sort()).toEqual([0, 2]);
      // Not a global switch-off: inside the crossing looking away from the stairs the deck above stays culled.
      w.culler.update(place({x: 21.5, y: FIX.lowerY + EYE, z: 12, yaw: 0, pitch: 0}), true);
      expect(w.culler.stats.levels).toEqual([2]);
      expect(w.culler.stats.culled).toBeGreaterThan(0);
      const deck: THREE.Mesh[] = [];
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.level === 1) deck.push(m); });
      expect(deck.length).toBeGreaterThan(0);
      expect(deck.every(culledNow)).toBe(true);
    } finally { un(); }
  });

  it('the oracle catches a culled destination level (sensitivity check)', () => {
    const un = installCanvasShim(false);
    try {
      const l = generateStation(9001, {archetype: 'side-mezzanine'});
      const w = buildWorld(l, mats(), {});
      const down = sampleLinks(l).find(k => k.upper === 0)!;
      // At the bottom stand point facing into the lower level, force the lower level onto the cull layer.
      const p = walkPoses(l, down).find(q => Math.abs(q.s) < 0.3 && q.label.includes('facing down') && q.pitch === 0)!;
      place(p);
      const vis = visibleMeshes(w.group, cam, 80, 45, {maxDist: VISIBLE_DEPTH, minPx: 3});
      const lower = [...vis.keys()].filter(m => m.userData.level === down.lower);
      expect(lower.length).toBeGreaterThan(0);
      for (const m of lower) m.layers.set(CULL_LAYER);
      expect([...vis.keys()].filter(culledNow).length).toBe(lower.length);
      for (const m of lower) m.layers.set(0);
    } finally { un(); }
  });

  for (const fam of ['side-mezzanine', 'island-ends', 'deep'] as const) {
    it(`${fam}: walking each stair link up and down, nothing visible is culled`, () => {
      const un = installCanvasShim(false);
      try {
        const l = generateStation(9001, {archetype: fam});
        const links = sampleLinks(l);
        expect(links.length).toBe(2);
        const w = buildWorld(l, mats(), {});
        const r = walkStation(l, w, links);
        expect(r.poses).toBeGreaterThan(200);
        // The camera really stood on shared run columns (both levels current) for part of the walk.
        expect(r.onRun).toBeGreaterThan(40);
        expect(r.bad, r.bad.slice(0, 12).join('\n')).toEqual([]);
      } finally { un(); }
    }, 120000);
  }
});
