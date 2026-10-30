// Seeded weapon finds (targeted pass 2026-10-28, pistol lane).
//
// The weapons the player does NOT start with are map finds, not a guaranteed spawn-side gift:
//  - start 'rifle' (generator default / gate-off fallback if PISTOL_ART_READY were false): the SHOTGUN is a find;
//  - start 'pistol' (shipped default since the user's pistol.glb landed, PISTOL_ART_READY): the SHOTGUN and the RIFLE are finds.
// Per non-start weapon: 0 copies in ~6 % of draws, 1 in ~80 %, 2 in ~14 % (never more than 2), each in a
// plausible back-of-house room (security office / agent control room / gun-locker fronts, locker & staff
// rooms, maintenance stores and workshops, the platform-end work zones) on any storey, on a flat walkable
// floor cell reachable from the spawn and at least FIND_MIN_SPAWN_M from it (straight line AND path).
// A box of matching ammo lies next to every find. Placement is pure data and deterministic per seed for a
// given start weapon (its own rng fork, after the loose supplies; it never rerolls on reload).

import type {Rng} from '../core/rng';
import {ammoItemFor} from '../items/calibers';
import {CELL, FLOOR, type Grid} from './grid';
import {levelDistance} from './levelGen';
import type {Area, PickupPlacement, StationLayout} from './stationTypes';

export type StartWeaponId = 'rifle' | 'pistol';

/** Minimum distance (m) of a weapon find from the player spawn, straight-line and along the path. */
export const FIND_MIN_SPAWN_M = 25;
/** Hard cap of copies per non-start weapon. */
export const FIND_MAX_PER_WEAPON = 2;

/**
 * The box of MATCHING ammo beside each weapon find: the weapon's own caliber (weapons/weapons.ts WeaponDef.caliber; tests keep the
 * two in step). Lane AMMO (knife-melee-20261030): the deliberate exception to the generic ~1/3-per-caliber ammo split.
 */
export const WEAPON_FIND_AMMO: Record<string, [string, number]> = {shotgun: [ammoItemFor('12ga'), 6], rifle: [ammoItemFor('5.56x45mm'), 20], pistol: [ammoItemFor('9x19mm'), 15]};

/** The weapons placed as finds for a starting weapon. */
export function findWeaponsFor(start: StartWeaponId): string[] {
  return start === 'pistol' ? ['shotgun', 'rifle'] : ['shotgun'];
}

const PURPOSE_W: Record<string, number> = {
  'security-office': 4, 'agent-office': 2.2, 'revenue-room': 1.4, 'locker-room': 2.5, 'staff-room': 1.5,
  'storage': 2, 'workshop': 2, 'electrical-room': 1, 'signal-room': 1.2, 'pump-room': 1, 'lost-property': 1.5,
  'custodial-room': 0.8, 'supply-closet': 0.6, 'janitor-closet': 0.4, 'electrical-closet': 0.4, 'first-aid-room': 0.6,
};
const TYPE_W: Partial<Record<string, number>> = {
  'agent-office': 2, 'crew-room': 1.5, 'storage': 1.5, 'utility': 1, 'stock-room': 0.8, 'service-corridor': 0.6,
  'supply-closet': 0.5, 'janitor-closet': 0.4, 'platform': 0.9,
};

function areaWeight(a: Area): number {
  if (a.role === 'stair' || a.type === 'stair-core' || a.storefront !== undefined) return 0;
  const w: number = (a.purpose ? PURPOSE_W[a.purpose] : undefined) ?? TYPE_W[a.type] ?? (a.level && !a.publicSpace ? 1 : 0);
  return a.level ? w * 1.3 : w; // spread finds onto the upper / lower storeys too
}

export interface FindsReport { weapons: string[]; placed: PickupPlacement[] }

export function placeWeaponFinds(layout: StationLayout, rng: Rng, start: StartWeaponId): FindsReport {
  const levels = layout.levels;
  const g0 = layout.grid, W = g0.w;
  const sp = layout.playerSpawn;
  const [sx, sy] = g0.cellOf(sp.x, sp.z);
  const dist = levelDistance(levels, sx, sy);
  const gridOf = (lv: number): Grid => levels[lv]?.grid ?? g0;
  const minCells = Math.ceil(FIND_MIN_SPAWN_M / CELL);
  const doorZone = levels.map(L => {
    const m = new Uint8Array(W * g0.h);
    for (const d of layout.doors) {
      if ((d.level ?? layout.areas[d.a]?.level ?? 0) !== L.id) continue;
      for (let y = d.y - 2; y < d.y + d.h + 2; y++) for (let x = d.x - 2; x < d.x + d.w + 2; x++) if (L.grid.inBounds(x, y)) m[L.grid.idx(x, y)] = 1;
    }
    return m;
  });
  const clear1 = (g: Grid, x: number, y: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy) || g.rampIdx[g.idx(x + ox, y + oy)] >= 0) return false;
    return true;
  };
  const taken = (lv: number, x: number, z: number, r: number) => layout.pickups.some(p => (p.level ?? 0) === lv && Math.hypot(p.x - x, p.z - z) < r);
  const cellsOf = (a: Area, minC: number, minStraight: number): number[] => {
    const lv = a.level ?? 0, g = gridOf(lv), dl = dist[lv];
    if (!dl) return [];
    const x0 = a.x, x1 = a.x + a.w;
    // Platform finds only in the work zones at the platform ends, never mid-platform beside the spawn.
    if (a.type === 'platform') { const e = Math.max(4, Math.round(a.w * 0.12)); return [...cellsIn(a, g, dl, lv, x0, x0 + e, minC, minStraight), ...cellsIn(a, g, dl, lv, x1 - e, x1, minC, minStraight)]; }
    return cellsIn(a, g, dl, lv, x0, x1, minC, minStraight);
  };
  const cellsIn = (a: Area, g: Grid, dl: Int32Array, lv: number, x0: number, x1: number, minC: number, minStraight: number): number[] => {
    const out: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = x0; x < x1; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (g.area[i] !== a.id || g.cells[i] !== FLOOR || !g.walkable(x, y) || g.rampIdx[i] >= 0 || doorZone[lv][i] || dl[i] < minC) continue;
      const [cx, cz] = g.center(x, y);
      if (Math.hypot(cx - sp.x, cz - sp.z) < minStraight || !clear1(g, x, y) || taken(lv, cx, cz, 1.2)) continue;
      out.push(i);
    }
    return out;
  };
  const put = (a: Area, i: number, itemId: string, count: number): PickupPlacement => {
    const lv = a.level ?? 0, g = gridOf(lv);
    const [x, z] = g.center(i % W, (i / W) | 0);
    const p: PickupPlacement = {itemId, count, x, y: lv ? g.floorOf(i) : 0, z, area: a.id, ...(lv ? {level: lv} : {})};
    layout.pickups.push(p);
    return p;
  };
  const pool = layout.areas.map(a => [a, areaWeight(a)] as [Area, number]).filter(e => e[1] > 0);
  const placed: PickupPlacement[] = [];
  const weaponAreas = new Set<number>();
  const weapons = findWeaponsFor(start);
  for (const wid of weapons) {
    const r = rng.next();
    const n = r < 0.06 ? 0 : r < 0.86 ? 1 : FIND_MAX_PER_WEAPON;
    const mine: PickupPlacement[] = [];
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < 14; t++) {
        const fresh = pool.filter(([a]) => !weaponAreas.has(a.id));
        const a = rng.weighted(fresh.length ? fresh : pool);
        const cells = cellsOf(a, minCells, FIND_MIN_SPAWN_M);
        if (!cells.length) continue;
        // A second copy of the same weapon lies well away from the first.
        const lv = a.level ?? 0, g = gridOf(lv);
        const ok = cells.filter(i => { const [x, z] = g.center(i % W, (i / W) | 0); return mine.every(m => Math.hypot(m.x - x, m.z - z) > 20 || (m.level ?? 0) !== lv); });
        if (!ok.length) continue;
        // Gun-locker fronts first (security office / control room lockers), else any clear cell.
        const lockers = layout.props.filter(p => p.kind === 'gunLocker' && p.area === a.id);
        let i = rng.pick(ok);
        if (lockers.length) {
          const L = lockers[0];
          let bd = Infinity;
          for (const c of ok) { const [x, z] = g.center(c % W, (c / W) | 0), d = Math.hypot(x - L.x, z - L.z); if (d > 0.9 && d < bd) { bd = d; i = c; } }
        }
        const p = put(a, i, wid, 1);
        mine.push(p); placed.push(p); weaponAreas.add(a.id);
        // Matching ammo beside it (1-2 m away on the same storey).
        const [ammo, cnt] = WEAPON_FIND_AMMO[wid];
        const around = cellsOf(a, 0, 0), ring = (lo: number, hi: number) => around.filter(c => { const [x, z] = g.center(c % W, (c / W) | 0), d = Math.hypot(x - p.x, z - p.z); return d >= lo && d <= hi; });
        const near = ring(0.9, 2.2).length ? ring(0.9, 2.2) : ring(0.6, 4.4);
        if (near.length) placed.push(put(a, rng.pick(near), ammo, cnt));
        else { const q: PickupPlacement = {...p, itemId: ammo, count: cnt, x: p.x + 0.2}; layout.pickups.push(q); placed.push(q); } // tight room: same cell
        break;
      }
    }
  }
  // Pistol start: the pistol's 9mm (9×19mm) joins the loose-floor economy (a few boxes in back-of-house rooms).
  if (start === 'pistol') {
    for (let k = 0, n = rng.int(3, 4); k < n; k++) {
      for (let t = 0; t < 8; t++) {
        const a = rng.weighted(pool);
        const cells = cellsOf(a, 24, 8);
        if (!cells.length) continue;
        placed.push(put(a, rng.pick(cells), 'ammo_9mm', 15));
        break;
      }
    }
  }
  return {weapons, placed};
}
