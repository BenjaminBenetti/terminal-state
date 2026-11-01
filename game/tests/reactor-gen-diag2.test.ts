import {describe, it, expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {generateReactorLevel, REACTOR_GEN_STATS} from '../src/gen/reactor/index';
import {FLOOR, VOID} from '../src/gen/grid';

describe('diag2', () => {
  it('maps', () => {
    const L = generateReactorLevel({levelSeed: 1});
    const out: string[] = [`ms ${REACTOR_GEN_STATS.ms.toFixed(0)} attempts ${REACTOR_GEN_STATS.attempts} issues ${REACTOR_GEN_STATS.issues.join(' | ')}`, `variant ${L.reactor!.pit.variant} grid ${L.grid.w}x${L.grid.h} ext tunnels ${L.extensions?.tunnels.length} annexes ${L.extensions?.annexes.length}`];
    for (const lv of L.levels) {
      out.push(`--- level ${lv.id} y ${lv.baseY}`);
      const g = lv.grid;
      for (let y = 0; y < g.h; y++) {
        let row = '';
        for (let x = 0; x < g.w; x++) {
          const i = g.idx(x, y), c = g.cells[i];
          row += c === VOID ? '~' : c !== FLOOR ? ' ' : g.rampIdx[i] >= 0 ? '/' : g.blocked[i] ? 'B' : Math.abs(g.floor[i] - lv.baseY) > 0.05 ? 'o' : '.';
        }
        out.push(row.replace(/\s+$/, ''));
      }
    }
    writeFileSync('/tmp/reactor/maps.txt', out.join('\n'));
    writeFileSync('/tmp/reactor/info.json', JSON.stringify({...L.reactor, decks: L.reactor!.decks.length}, null, 1));
    expect(true).toBe(true);
  });
});
