// Task studio-surface-host-ground-connectors-20261118-053602-01: the Office / Mall connector tube's one shape (gen/surface/connectorShape.ts)
// and its view (world/surface/connectorView.ts): the tube-local frame is a ROTATION of the world frame (never a mirror: a strafe right
// stays right, a turn stays a turn), the walk model's cells, and the drawn tube (flaps, tags, the host collar, the district plate).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CELL, FLOOR} from '../src/gen/grid';
import {CONNECTOR, connectorModel, connectorOpen, connectorStepYaw, connectorToStep, connectorToWorld, connectorWorldYaw, stepToConnector, worldToConnector} from '../src/gen/surface/connectorShape';
import type {SurfaceConnector} from '../src/gen/surface/surfaceTypes';
import {CONNECTOR_LOOK, buildConnectorView, connectorProfile} from '../src/world/surface/connectorView';
import {Player} from '../src/player/player';
import {installCanvasShim} from './helpers/canvas2d';

const rec = (over: Partial<SurfaceConnector> = {}): SurfaceConnector => ({
  host: 'office', end: 'host', x: 17.75, z: 0.5, y: 5.79, level: 1, yaw: 0, len: CONNECTOR.len, door: {depth: 0.5, width: 1.0, height: 2.1, collar: 1.0}, area: 3, ...over,
});

describe('connector frame', () => {
  it('maps s / t to world and back for any yaw, as a rotation (forward x right keeps its sign)', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1, 3 * Math.PI / 2]) {
      const c = rec({yaw, x: 10, z: -4});
      for (const [s, t] of [[0, 0], [2.5, 0.4], [-0.8, -0.3], [4.9, 1.2]]) {
        const [x, z] = connectorToWorld(c, s, t), [s2, t2] = worldToConnector(c, x, z);
        expect(s2).toBeCloseTo(s, 9); expect(t2).toBeCloseTo(t, 9);
      }
      // +s is the yaw's forward (-sin yaw, -cos yaw); +t its right (-f_z, f_x)
      const [x1, z1] = connectorToWorld(c, 1, 0), [x2, z2] = connectorToWorld(c, 0, 1);
      expect(x1 - 10).toBeCloseTo(-Math.sin(yaw), 9); expect(z1 + 4).toBeCloseTo(-Math.cos(yaw), 9);
      const f = [x1 - 10, z1 + 4], r = [x2 - 10, z2 + 4];
      expect(f[0] * r[1] - f[1] * r[0], 'a rotation of yaw 0 (forward -z, right +x): same handedness').toBeCloseTo(1, 9);
      // the step frame: the same handedness, the yaw a plain offset
      const m = connectorModel(c), [sx, sz] = connectorToStep(m, 1.5, 0.25), [s3, t3] = stepToConnector(m, sx, sz);
      expect(s3).toBeCloseTo(1.5, 9); expect(t3).toBeCloseTo(0.25, 9);
      for (const wy of [0, 1, -2]) expect(connectorWorldYaw(c, connectorStepYaw(c, wy))).toBeCloseTo(wy, 9);
    }
  });

  it('the walk model: the tube, the host doorway + lobby apron (host world) or the tent apron (district), solid elsewhere', () => {
    const host = rec(), tent = rec({end: 'tent'});
    expect(connectorOpen(host, 2, 0.9)).toBe(true);
    expect(connectorOpen(host, 2, 1.05)).toBe(false);
    expect(connectorOpen(host, -0.3, 0.45)).toBe(true);
    expect(connectorOpen(host, -0.3, 0.6), 'the doorway is the door\'s width').toBe(false);
    expect(connectorOpen(host, -0.9, 1.3), 'the lobby apron').toBe(true);
    expect(connectorOpen(host, 4.7, 0), 'no tent apron in the host world').toBe(false);
    expect(connectorOpen(tent, -0.2, 0), 'no doorway in the district').toBe(false);
    expect(connectorOpen(tent, 5.0, 1.2), 'the tent apron').toBe(true);
    for (const c of [host, tent]) {
      const m = connectorModel(c), g = m.grid;
      let open = 0;
      for (let cy = 0; cy < g.h; cy++) for (let cx = 0; cx < g.w; cx++) {
        const i = g.idx(cx, cy), t = (cx + 0.5) * CELL - m.ox, s = m.oz - (cy + 0.5) * CELL;
        expect(g.cells[i] === FLOOR, `cell ${cx},${cy}`).toBe(connectorOpen(c, s, t));
        if (g.cells[i] === FLOOR) { open++; expect(g.ceil[i]).toBeCloseTo(CONNECTOR.ceil, 5); }
        if (cx === 0 || cy === 0 || cx === g.w - 1 || cy === g.h - 1) expect(g.cells[i] === FLOOR, 'a solid ring').toBe(false);
      }
      expect(open).toBeGreaterThan(30);
    }
  });

  it('Player.update on the walk model: walking forward at the record\'s yaw goes +s, strafing right goes +t (any record yaw)', () => {
    for (const yaw of [0, 1.1, Math.PI, -0.6]) {
      const c = rec({yaw}), m = connectorModel(c), P = new Player();
      const run = (keys: string[], frames: number): [number, number] => {
        const [sx, sz] = connectorToStep(m, 2.0, 0);
        P.spawn(sx, sz, connectorStepYaw(c, yaw), 0);
        const input = {keys: new Set(keys), down: (k: string) => keys.includes(k), hit: () => false, dx: 0, dy: 0} as unknown as Parameters<Player['update']>[1];
        for (let i = 0; i < frames; i++) P.update(1 / 60, input, m.levels, null, {aiming: false, speedMult: 1, canSprint: false});
        return stepToConnector(m, P.x, P.z);
      };
      const [sf] = run(['KeyW'], 12);
      expect(sf, 'forward = toward the tent').toBeGreaterThan(2.05);
      const [, tr] = run(['KeyD'], 12);
      expect(tr, 'strafe right = +t (the walker\'s right)').toBeGreaterThan(0.05);
    }
  });
});

describe('connector view', () => {
  it('builds the tube at its record: tagged meshes, flaps that roll, the host collar / the district plate', () => {
    const restore = installCanvasShim(false);
    try { viewChecks(); } finally { restore(); }
  });
});

function viewChecks(): void {
  {
    const P = connectorProfile();
    expect(Math.max(...P.map(p => p.y))).toBeCloseTo(CONNECTOR.crownH, 6);
    expect(Math.max(...P.map(p => Math.abs(p.t)))).toBeCloseTo(CONNECTOR.width / 2, 6);
    const v = buildConnectorView(rec({end: 'host', door: {depth: 2.5, width: 2.0, height: 2.6, collar: 4.0}, x: 3, z: 7, yaw: 1.2}));
    expect(v.root.position.toArray()).toEqual([3, 5.79, 7]);
    expect(v.root.rotation.y).toBeCloseTo(1.2, 9);
    const meshes: THREE.Mesh[] = [];
    v.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(6);
    for (const m of meshes) { expect(m.userData.level).toBe(1); expect(m.userData.noOcclusion).toBe(true); expect(m.castShadow).toBe(false); }
    // the tube stays inside its own outline (s 0 .. len, |t| <= collar / 2 + skirt, y >= -skirt)
    const o = buildConnectorView(rec({end: 'host', door: {depth: 2.5, width: 2.0, height: 2.6, collar: 4.0}, x: 0, z: 0, y: 0, yaw: 0}));
    const box = new THREE.Box3().setFromObject(o.root);
    o.dispose();
    expect(box.min.z).toBeGreaterThan(-CONNECTOR.len - 0.01);
    expect(box.max.z).toBeLessThan(0.06);
    expect(box.max.x, 'the collar: half the opening + its lap').toBeLessThan(2.2);
    expect(box.min.y).toBeGreaterThan(-CONNECTOR_LOOK.skirt - 0.01);
    // the flaps: shut hang the full opening, rolled leave a strip
    v.setFlap(0, 0);
    expect(v.flaps[0].children[0].scale.y).toBe(1);
    v.setFlap(0, 1);
    expect(v.flaps[0].children[0].scale.y).toBeCloseTo(CONNECTOR_LOOK.rolled, 9);
    expect(v.flaps[0].children[1].position.y, 'the roll at the rolled sheet\'s edge').toBeCloseTo(-CONNECTOR.wallH * CONNECTOR_LOOK.rolled, 9);
    const n = v.geometries.length;
    v.dispose();
    expect(v.root.parent).toBe(null);
    expect(n).toBeGreaterThan(4);
    // the district's tube has no collar (and a plate only with a document to draw its text)
    const d = buildConnectorView(rec({end: 'tent'}), {name: 'Ashford Tower'});
    let plates = 0;
    d.root.traverse(o => { if (o.name === 'surface-connector-plate') plates++; });
    expect(plates, 'the host name plate').toBe(1);
    d.dispose();
  }
}
