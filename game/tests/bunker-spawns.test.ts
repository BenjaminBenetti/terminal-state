// Task studio-bunker-level-20261109-072224-01: THE BUNKER's enemies (ai/spawnTables.ts BUNKER_SPAWN_PROFILE; gen/bunker/spawns.ts) over
// a bounded census of generated levels:
//  - the profile validates; every storey run is tagged with its context (station / floor 1-3 / ring 4-5) and stays within its count;
//  - THE SIREN: drawn in the storey pools, placed only in enclosed rooms of the shelter storeys (never the station, a stairwell,
//    corridor, washroom), <= 3 per level, 24 m apart, and actually present on a good share of levels (~1-2 per level, like the Mall /
//    Office);
//  - THE STRAINER: only the 'damp' context's pool gives it weight; placed only in the damp areas (layout.bunker.damp), at most one per
//    level, on well under every level (never a guaranteed boss);
//  - normal outfits only (no cosplay / lingerie looks), no hordes, the arrival keep-off (no enemy within the profile's start distance).
// (Task studio-bunker-rework-20261109-205115-01: these pin VERSION 1 explicitly — an entered station keeps it; version 2 has its own tests.)
import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {BUNKER_SPAWN_PROFILE, SPAWN_PROFILES, STRAINER_CONTEXTS, spawnContextOf, validateSpawnProfile} from '../src/ai/spawnTables';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {bunkerSpawnContext} from '../src/gen/bunker/spawns';
import {levelDistance} from '../src/gen/levelGen';
import type {StationLayout} from '../src/gen/stationTypes';

const LOG = '/tmp/bunker-spawns.log';
const N = 32;
const SEEDS = Array.from({length: N}, (_, k) => 4401 + k * 7919);

describe('bunker enemies', () => {
  writeFileSync(LOG, '');
  const layouts: StationLayout[] = [];
  const all = () => { if (!layouts.length) for (const s of SEEDS) layouts.push(generateBunkerLevel({levelSeed: s, layoutVersion: 1})); return layouts; };

  it('the profile is registered and validates; the Strainer is context-locked to the damp zone', () => {
    expect(SPAWN_PROFILES.bunker).toBe(BUNKER_SPAWN_PROFILE);
    expect(validateSpawnProfile(BUNKER_SPAWN_PROFILE)).toEqual([]);
    expect(STRAINER_CONTEXTS).toContain('damp');
    for (const [id, c] of Object.entries(BUNKER_SPAWN_PROFILE.contexts)) {
      const w = (c!.families ?? BUNKER_SPAWN_PROFILE.families).find(([f]) => f === 'strainer')?.[1] ?? 0;
      // the damp zone's own pool, and the shared annex contract's (never run here: trackExtensions 'none')
      if (id === 'damp') expect(w).toBeGreaterThan(0); else if (id !== 'service') expect(w, id).toBe(0);
    }
    expect(BUNKER_SPAWN_PROFILE.families.find(([f]) => f === 'strainer')![1]).toBe(0);
    expect(BUNKER_SPAWN_PROFILE.horde).toBeUndefined();
  });

  it('census: storey contexts, the Siren in rooms on a good share of levels, a rare damp Strainer', () => {
    let sirens = 0, strainers = 0, withSiren = 0, withStrainer = 0, maxSiren = 0, total = 0, dampRuns = 0;
    const perCtx: Record<string, number> = {};
    for (const L of all()) {
      const b = L.bunker!, damp = new Set(b.damp);
      const g0 = L.grid, [sx, sy] = g0.cellOf(b.start.x, b.start.z);
      const dist = levelDistance(L.levels, sx, sy, 0, L.levelLinks);
      let s = 0, t = 0;
      L.zombies.forEach((z, i) => {
        const lv = z.level ?? 0, ctx = spawnContextOf(L, BUNKER_SPAWN_PROFILE, i) ?? '?';
        perCtx[ctx] = (perCtx[ctx] ?? 0) + 1;
        if (ctx !== 'damp' && ctx !== 'service') expect(ctx, `spawn ${i} level ${lv}`).toBe(bunkerSpawnContext(lv));
        expect(z.horde).toBeUndefined();
        expect(z.look).toBeUndefined();
        const a = L.areas[z.area ?? -1];
        const g = L.levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z);
        expect(dist[lv][g.idx(cx, cy)]).toBeGreaterThanOrEqual(BUNKER_SPAWN_PROFILE.contexts.station!.placement.startCells);
        if (z.archetype === 'siren') {
          s++;
          expect(lv).toBeGreaterThan(0);
          expect(a.kind).toBe('room');
          expect(['washroom', 'stair-core']).not.toContain(a.type);
        }
        if (z.archetype === 'strainer') {
          t++;
          expect(ctx).toBe('damp');
          expect(damp.has(a.id)).toBe(true);
        }
        if (ctx === 'damp') { dampRuns++; expect(damp.has(a.id)).toBe(true); }
      });
      const sp = L.zombies.filter(z => z.archetype === 'siren');
      for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
        expect(Math.hypot(sp[i].x - sp[j].x, (sp[i].y ?? 0) - (sp[j].y ?? 0), sp[i].z - sp[j].z)).toBeGreaterThanOrEqual(24 - 1e-6);
      }
      expect(s).toBeLessThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(1);
      sirens += s; strainers += t; total += L.zombies.length;
      if (s) withSiren++;
      if (t) withStrainer++;
      maxSiren = Math.max(maxSiren, s);
    }
    const line = `census ${N} levels: enemies ${total} (mean ${(total / N).toFixed(1)}), contexts ${JSON.stringify(perCtx)}, Sirens mean ${(sirens / N).toFixed(2)} (levels with one ${withSiren}/${N}, max ${maxSiren}), Strainers mean ${(strainers / N).toFixed(2)} (levels with one ${withStrainer}/${N}), damp spawns ${dampRuns}`;
    appendFileSync(LOG, line + '\n');
    expect(sirens / N).toBeGreaterThanOrEqual(0.9);
    expect(sirens / N).toBeLessThanOrEqual(2.5);
    expect(withSiren / N).toBeGreaterThanOrEqual(0.65);
    expect(strainers / N).toBeLessThan(0.6);
    expect(strainers).toBeGreaterThan(0);
    expect(total / N).toBeLessThanOrEqual(BUNKER_SPAWN_PROFILE.budgets!.ambient.total);
  });
});
