// Task office-overhaul-20261030 (lane TENANTS): which company occupies which office floor — deterministic from the LEVEL seed only
// (the frame, the carving, the dressing and the directory all agree, retries included). Pure data.
//
// Floors 2..8 each get a company from the 20-company pool (gen/office/companies.ts), all distinct, seeded order; in about a third of
// the seeds one company takes two consecutive floors (its reception on the lower one: part 0 of 2, the upper floor part 1 of 2).
// The lobby (floor 1) is neutral and never a tenant. Every company is reachable over seeds (uniform shuffle).

import {Rng, hashString} from '../../core/rng';
import {COMPANIES, COMPANY_IDS, type Company} from './companies';
import type {TenantFloor} from './overhaulTypes';

/** Office floors with a tenant. */
export const TENANT_FLOORS: readonly number[] = [2, 3, 4, 5, 6, 7, 8];
/** Chance a level has one company spanning two consecutive floors. */
export const TWO_FLOOR_CHANCE = 0.35;

const cache = new Map<number, TenantFloor[]>();

/** The tenants of floors 2..8 of a level seed (cached; callers must not mutate the result). */
export function officeTenants(levelSeed: number): TenantFloor[] {
  const key = levelSeed >>> 0;
  let out = cache.get(key);
  if (out) return out;
  const rng = new Rng(hashString('office-tenants-v1', key));
  const order = rng.shuffle(COMPANY_IDS.slice());
  const span = rng.chance(TWO_FLOOR_CHANCE) ? rng.int(TENANT_FLOORS[0], TENANT_FLOORS[TENANT_FLOORS.length - 1] - 1) : -1;
  out = [];
  let next = 0;
  for (const floor of TENANT_FLOORS) {
    const c: Company = COMPANIES[floor === span + 1 ? out[out.length - 1].company : order[next++]];
    const parts = floor === span || floor === span + 1 ? 2 : 1;
    out.push({floor, company: c.id, name: c.name, tagline: c.tagline, palette: {...c.palette}, finish: c.finish, part: floor === span + 1 ? 1 : 0, parts});
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/** The tenant of one floor (undefined for the lobby / station / roof). */
export function tenantOf(levelSeed: number, floor: number): TenantFloor | undefined {
  return officeTenants(levelSeed).find(t => t.floor === floor);
}
