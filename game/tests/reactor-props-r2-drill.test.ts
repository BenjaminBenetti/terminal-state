// Task reactor-playtest-round2-20261102 (lane PROPS), user bullet 12: "the drill machine found in the mine area is comically small".
// The mines' drill jumbo (REACTOR_X_KIT.drillRig, cooked 3.5 x 1.28 x 0.98 m: knee / waist high) is drawn at its runtime fit
// MINES_FIT.drillRig (a derived uniform transform of the same GLB: no re-cook, no new model). Its collider, footprint, ground contact and
// placement bounds move with it: real generated layouts (the mines dress, the visuals plan) and the cooked triangles.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {MINE_PIECE, MINE_PIECE_SIZE} from '../src/gen/reactor/complex/minesDress';
import {MINES_FIT, MINES_MODELS, minesModelSize} from '../src/world/reactor/minesAssets';
import {planMinesVisuals} from '../src/world/reactor/minesVisuals';
import {REACTOR_X_KIT} from '../src/assets/reactorExpansionKit.generated';
import {testMeshOf} from './reactor-x-paths-meshes';

const SEEDS = [9100, 218558, 637474, 42];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => { let L = cache.get(seed); if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed}); cache.set(seed, L); } return L; };

describe('the mines drill jumbo at a believable size (bullet 12)', () => {
  it('runtime size: a compact face-drill rig next to a 1.8 m player (2.2-2.8 m tall, the carrier 4-5 m, <= 7 x 2.4 m overall)', () => {
    const [L, H, W] = minesModelSize('drillRig');
    expect(MINES_FIT.drillRig).toBeGreaterThan(1.5);
    expect(MINES_MODELS.drillRig).toBe(REACTOR_X_KIT.drillRig); // the same cooked model (derived transform only)
    expect(H).toBeGreaterThanOrEqual(2.2); expect(H).toBeLessThanOrEqual(2.8);
    expect(L).toBeLessThanOrEqual(7.0); expect(W).toBeLessThanOrEqual(2.4);
    // the cooked triangles: the carrier = the wheeled chassis below the boom (y < 0.7 m at scale 1; the feed boom rides above it)
    const t = testMeshOf(REACTOR_X_KIT.drillRig.url)!;
    let cx0 = Infinity, cx1 = -Infinity;
    for (let i = 0; i + 2 < t.length; i += 3) if (t[i + 1] < 0.7) { cx0 = Math.min(cx0, t[i]); cx1 = Math.max(cx1, t[i]); }
    const carrier = (cx1 - cx0) * MINES_FIT.drillRig;
    expect(carrier).toBeGreaterThanOrEqual(4.0); expect(carrier).toBeLessThanOrEqual(5.0);
    // the dress pass's piece size is the runtime size (rounded up: the model stays inside its collider)
    const S = MINE_PIECE_SIZE.drill;
    expect(S.l).toBeGreaterThanOrEqual(L); expect(S.l - L).toBeLessThan(0.002);
    expect(S.w).toBeGreaterThanOrEqual(W); expect(S.w - W).toBeLessThan(0.002);
    expect(S.h).toBeGreaterThanOrEqual(H); expect(S.h - H).toBeLessThan(0.011);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: one drill in the mines; its collider = the model's footprint + height; grounded; the model inside its collider`, () => {
      const lay = level(seed), mines = lay.reactor!.complexes!.find(c => c.id === 'mines');
      if (!mines) return; // (no mines complex on this seed: nothing to place)
      const drills = lay.props.filter(p => p.kind === 'annexMachine' && p.variant === MINE_PIECE.drill);
      expect(drills.length, `seed ${seed}`).toBe(1);
      const d = drills[0], [L, H, W] = minesModelSize('drillRig');
      expect(Math.max(d.hx, d.hz) * 2).toBeCloseTo(L, 2);
      expect(Math.min(d.hx, d.hz) * 2).toBeCloseTo(W, 2);
      expect(d.h).toBeGreaterThanOrEqual(H - 1e-6); expect(d.h - H).toBeLessThan(0.011);
      // on the floor of every cell under it, below the ceiling, inside its room
      const g = lay.levels[mines.level].grid, a = lay.areas[d.area];
      expect(mines.areas).toContain(d.area);
      for (let x = d.x - d.hx + 0.05; x < d.x + d.hx; x += 0.25) for (let z = d.z - d.hz + 0.05; z < d.z + d.hz; z += 0.25) {
        const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
        expect(g.area[i], `seed ${seed} drill cell`).toBe(a.id);
        expect(g.floor[i]).toBeCloseTo(d.y, 3);
        expect(g.ceil[i]).toBeGreaterThan(d.y + d.h);
        expect(g.blocked[i]).toBe(1); // the collider blocks what it covers
      }
      // the visuals: the model at MINES_FIT on the collider, long axis along it, its cooked triangles inside the box and on the floor
      const plan = planMinesVisuals(lay)!, pl = plan.models.drillRig;
      expect(pl.length).toBe(1);
      const m = pl[0];
      expect([m.sx, m.sy, m.sz]).toEqual([MINES_FIT.drillRig, MINES_FIT.drillRig, MINES_FIT.drillRig]);
      expect([m.x, m.y, m.z]).toEqual([d.x, d.y, d.z]);
      const M = new THREE.Matrix4().compose(new THREE.Vector3(m.x, m.y, m.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.yaw), new THREE.Vector3(m.sx, m.sy, m.sz));
      const t = testMeshOf(REACTOR_X_KIT.drillRig.url)!, v = new THREE.Vector3();
      let y0 = Infinity, out = 0;
      for (let i = 0; i + 2 < t.length; i += 3) {
        v.set(t[i], t[i + 1], t[i + 2]).applyMatrix4(M);
        y0 = Math.min(y0, v.y);
        if (Math.abs(v.x - d.x) > d.hx + 0.01 || Math.abs(v.z - d.z) > d.hz + 0.01 || v.y > d.y + d.h + 0.01) out++;
      }
      expect(out, `seed ${seed}: model vertices outside the collider`).toBe(0);
      expect(Math.abs(y0 - d.y), `seed ${seed}: grounded`).toBeLessThan(0.01);
    });
  }
});
