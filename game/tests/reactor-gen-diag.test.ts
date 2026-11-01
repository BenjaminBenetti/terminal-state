import {describe, it, expect} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {MALL_SPAWN_PROFILE, type SpawnProfile} from '../src/ai/spawnTables';
import {reactorAttempt} from '../src/gen/reactor/index';
import {reactorIssues} from '../src/gen/reactor/validate';
import {REACTOR_CARVE_FAILS} from '../src/gen/reactor/carve';

const ring = MALL_SPAWN_PROFILE.contexts.ring!, pit = MALL_SPAWN_PROFILE.contexts.pit!;
const SP: SpawnProfile = {...MALL_SPAWN_PROFILE, id: 'reactor', contexts: {station: pit, floor: ring, ring, pit, service: MALL_SPAWN_PROFILE.contexts.service}};

describe('diag', () => {
  it('runs', () => {
    const out: string[] = [];
    for (const seed of [1, 2, 3]) {
      const t0 = performance.now();
      const L = reactorAttempt({levelSeed: seed}, 0, {spawns: SP, trackExt: 'none'});
      const ms = performance.now() - t0;
      out.push(`seed ${seed}: ${L ? 'ok' : 'carve fail'} ${ms.toFixed(0)} ms ${JSON.stringify(REACTOR_CARVE_FAILS)}`);
      if (L) {
        const t1 = performance.now();
        const iss = reactorIssues(L, {startCells: 36});
        out.push(`  validate ${(performance.now() - t1).toFixed(0)} ms grid ${L.grid.w}x${L.grid.h} zombies ${L.zombies.length} pickups ${L.pickups.length} props ${L.props.length} lights ${L.lights.length}`);
        out.push(...iss.slice(0, 40).map(s => '  ' + s));
      }
    }
    mkdirSync('/tmp/reactor', {recursive: true});
    writeFileSync('/tmp/reactor/diag.txt', out.join('\n'));
    expect(true).toBe(true);
  });
});
