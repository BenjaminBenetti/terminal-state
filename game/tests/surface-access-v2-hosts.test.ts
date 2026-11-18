// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, follow-up 2), re-targeted by task
// studio-surface-host-ground-connectors-20261118-053602-01: SURFACE RUN version 2 — the OFFICE / MALL host's way out is the on-foot
// CONNECTOR from its version-1 doorway (gen/surface/accessConnector.ts; it replaces these hosts' version-2 cargo lift: both exit at ground
// level), through the level registry:
//  - every present station (a sweep) gets the connector at the version-1 doorway's storey and position (the Office's makeshift door
//    position in the lobby's boarded entrance; the Mall's seed-hashed usable street exit); no lift;
//  - the host grid is NOT carved (the tube stands outside it): every storey's cells are the plain station's;
//  - the station is the version-1 one exactly but for its access record (kind 'connector', its return pose, the tube record) and the
//    Office's moved barricade pieces' memory anchors (PropPlacement.memAt = where each stood in the plain / lift-era station);
//  - the return pose (every loading-screen arrival) is walkable in the doorway's area, ~1.5 m inside it, reachable on foot from the spawn,
//    and nothing reachable in the plain station is cut off.
// (tests/surface-connector-pins.test.ts pins the lift-era indices of the official starters and ten seeds per host; tests/surface-access.test.ts
// / surface-v1-compat.test.ts pin version 1.)
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {CONNECTOR, worldToConnector} from '../src/gen/surface/connectorShape';
import {levelDistance} from '../src/gen/levelGen';
import type {StationLayout} from '../src/gen/stationTypes';

const seeds = (host: SurfaceHost, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) out.push(s);
  return out;
};
const gen = (host: SurfaceHost, s: number, v?: number): StationLayout => LEVELS[host].generate('main', {levelSeed: s, ...(v !== undefined ? {surfaceVersion: v} : {})});
const plain = (x: unknown) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const SWEEP = Number(process.env.SURFACE_HOST_SWEEP ?? 6);
/** The layout's lists without the access record / grids (compared on their own) and the props' memory anchors. */
const rest = (L: StationLayout) => {
  const {surfaceAccess: _a, levels: _l, grid: _g, props, ...o} = L as StationLayout & Record<string, unknown>;
  return plain({...o, props: props.map(({memAt: _m, ...p}) => p)});
};

describe('Surface Run v2: the Office / Mall connector at the version-1 doorway (no lift)', () => {
  for (const host of ['office', 'mall'] as const) {
    it(`${host}: every present station of a sweep walks out through its connector at the version-1 doorway; the grid uncarved; nothing else moved`, () => {
      const report: string[] = [];
      for (const s of seeds(host, SWEEP)) {
        const L = gen(host, s, SURFACE_VERSION), V = gen(host, s, 1), P = gen(host, s, 0), a = L.surfaceAccess!, v1 = V.surfaceAccess!;
        expect(a, `${host} ${s}`).toBeTruthy();
        expect(a.kind, `${host} ${s}: the connector`).toBe('connector');
        expect(a.v).toBe(2);
        expect(a.lift, 'no lift').toBeUndefined();
        expect(v1.kind).toBe(host === 'office' ? 'office-door' : 'mall-door');
        const c = a.connector!;
        expect(c).toMatchObject({host, end: 'host', len: CONNECTOR.len});
        // at the version-1 doorway: its storey, its door / exit, the record's mouth at the version-1 door's position along the facade
        expect(c.level, `${host} ${s}: the access storey`).toBe(v1.returnPose.level);
        if (host === 'office') {
          expect(plain(a.door)).toEqual(plain(v1.door));
          const [, t] = worldToConnector(c, v1.door!.x, v1.door!.z);
          expect(Math.abs(t), `${host} ${s}: the tube's axis through the version-1 door`).toBeLessThan(1e-3);
        } else expect(a.exit, `${host} ${s}: the version-1 usable exit`).toBe(v1.exit);
        // the host grid is not carved: every storey's cells are the plain station's (and the version-1 one's)
        L.levels.forEach((Lv, k) => {
          expect(Lv.grid.cells.length).toBe(P.levels[k].grid.cells.length);
          let diff = 0;
          for (let i = 0; i < Lv.grid.cells.length; i++) if (Lv.grid.cells[i] !== P.levels[k].grid.cells[i] || Lv.grid.cells[i] !== V.levels[k].grid.cells[i]) diff++;
          expect(diff, `${host} ${s}: storey ${k} cells`).toBe(0);
        });
        // the version-1 station exactly, but the access record and the memory anchors
        expect(rest(L)).toEqual(rest(V));
        const moved = L.props.flatMap((p, i) => (p.memAt ? [i] : []));
        if (host === 'mall') expect(plain(L.props)).toEqual(plain(P.props));
        for (const i of moved) {
          // a moved piece: where version 1 puts it, anchored where it stood in the plain (lift-era) station
          expect(plain(L.props[i].memAt)).toEqual({x: P.props[i].x, z: P.props[i].z});
          expect([L.props[i].x, L.props[i].z]).toEqual([V.props[i].x, V.props[i].z]);
        }
        L.props.forEach((p, i) => { if (!p.memAt) expect([p.kind, p.x, p.z], `${host} ${s}: prop ${i}`).toEqual([P.props[i].kind, P.props[i].x, P.props[i].z]); });
        // the return pose: walkable in the doorway's area, ~1.5 m inside the doorway, facing in, reachable on foot from the spawn
        const g = L.levels[c.level].grid, p = a.returnPose, [ps, pt] = worldToConnector(c, p.x, p.z);
        expect(p.level).toBe(c.level);
        expect(g.walkable(...g.cellOf(p.x, p.z)), `${host} ${s}: the return pose`).toBe(true);
        expect(g.area[g.idx(...g.cellOf(p.x, p.z))]).toBe(c.area);
        expect(g.circleClear(p.x, p.z, 0.4)).toBe(true);
        expect(ps).toBeLessThan(-c.door.depth - 1.0);
        expect(Math.abs(pt)).toBeLessThanOrEqual(1.0);
        const sp = L.levels[0].grid.cellOf(L.playerSpawn.x, L.playerSpawn.z);
        const before = levelDistance(P.levels, sp[0], sp[1], 0, P.levelLinks), after = levelDistance(L.levels, sp[0], sp[1], 0, L.levelLinks);
        // (a cell a moved piece now stands on is blocked by it, as in version 1: not cut off)
        let lost = 0, under = 0;
        before.forEach((b, k) => { const gk = L.levels[k].grid, gp = P.levels[k].grid; for (let i = 0; i < b.length; i++) if (b[i] >= 0 && after[k][i] < 0) { if (gk.blocked[i] && !gp.blocked[i]) under++; else lost++; } });
        expect(lost, `${host} ${s}: cells cut off`).toBe(0);
        if (host === 'mall' || !moved.length) expect(under).toBe(0);
        const [mx, my] = g.cellOf(p.x, p.z);
        expect(after[c.level][g.idx(mx, my)], 'the return pose is reachable on foot').toBeGreaterThanOrEqual(0);
        report.push(`${host} ${s}: storey ${c.level}, yaw ${c.yaw.toFixed(3)}, door ${c.door.width} x ${c.door.height} m (depth ${c.door.depth}), ${moved.length} pieces moved`);
      }
      if (process.env.SURFACE_HOST_LOG) process.stdout.write(`${report.join('\n')}\n`);
    }, 600_000);
  }
});
