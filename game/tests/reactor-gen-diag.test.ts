import {describe, it, expect} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {generateReactorLevel, REACTOR_GEN_STATS, REACTOR_REJECTS} from '../src/gen/reactor/index';
import {REACTOR_CARVE_FAILS} from '../src/gen/reactor/carve';

describe('diag', () => {
  it('runs', () => {
    const out: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]) {
      const L = generateReactorLevel({levelSeed: seed});
      out.push(`seed ${seed}: ${REACTOR_GEN_STATS.ms.toFixed(0)} ms attempts ${REACTOR_GEN_STATS.attempts} carveFails ${REACTOR_GEN_STATS.carveFails} variant ${L.reactor!.pit.variant} grid ${L.grid.w}x${L.grid.h} ext ${L.extensions?.tunnels.length ?? 0}/${L.extensions?.annexes.length ?? 0} z ${L.zombies.length} issues ${REACTOR_GEN_STATS.issues.slice(0, 3).join(' | ')}`);
    }
    out.push(JSON.stringify([...REACTOR_REJECTS]), JSON.stringify(REACTOR_CARVE_FAILS));
    mkdirSync('/tmp/reactor', {recursive: true});
    writeFileSync('/tmp/reactor/diag.txt', out.join('\n'));
    expect(true).toBe(true);
  });
});
