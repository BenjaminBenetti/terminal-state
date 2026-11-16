// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): the v2 deep interior's last pass (rooms/index.ts, after the
// shared finish): a walkable upper floor never stands empty — when the building's enemy roll put none of its permanent interior enemies
// upstairs, one more stands in its biggest upper room (an ordinary layout zombie: killed once, never respawned). Own fork: RNG-neutral.

import {CELL} from '../../grid';
import type {InteriorBuilder} from './builder';
import {spawnIn} from './finish';

export function deepFinish(b: InteriorBuilder): void {
  if (b.carvedStoreys < 2 || b.storeys.length < 2) return;
  const lv = b.storeys[1].level;
  const upper = b.roomsOn(1).filter(r => r.role !== 'roof' && r.role !== 'stair' && r.role !== 'stair-run' && r.enemies > 0 && r.area.w * r.area.h * CELL * CELL >= 6);
  if (!upper.length) return;
  const zs = b.stub.zombies;
  if (zs.some(z => (z.level ?? 0) === lv && upper.some(r => r.area.id === z.area))) return;
  const rng = b.rng.fork('deep-enemies');
  const doors = b.doorIndex();
  for (const r of upper.slice().sort((p, q) => q.area.w * q.area.h - p.area.w * p.area.h)) {
    const z = spawnIn(b, r, zs, rng, doors.get(r.area.id) ?? []);
    if (z) { zs.push(z); return; }
  }
}
