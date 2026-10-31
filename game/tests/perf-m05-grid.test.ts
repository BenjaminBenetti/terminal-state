// TEMPORARY lane PERF probe (deleted before hand-off): grid facts for the same-storey visibility idea.
import {describe, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {setMallVariantOverride} from '../src/gen/mall/frame';
import {CELL} from '../src/gen/grid';
describe('grid probe', () => {
  it('facts', () => {
    setMallVariantOverride('arcade-loop');
    const layout = LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: codeToSeed('t3a')!, startWeapon: 'pistol'});
    setMallVariantOverride(null);
    const out: string[] = [];
    out.push(`grid ${layout.grid.w} x ${layout.grid.h} levels ${layout.levels.length} bases ${layout.levels.map(l => l.baseY)}`);
    // occupied bbox
    for (const L of layout.levels) {
      const g = L.grid; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, open = 0;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const c = g.cells[y * g.w + x]; if (c !== 0) { open++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
      out.push(`level ${L.id} base ${L.baseY} open ${open} bbox x ${x0}..${x1} y ${y0}..${y1}`);
    }
    const m = layout.mall!;
    for (const s of m.shops.slice(0, 6)) {
      const f = s.frontage; const g = layout.levels[s.level].grid;
      const cells: string[] = [];
      const n = Math.max(1, Math.round(Math.hypot(f.x1 - f.x0, f.z1 - f.z0) / CELL));
      for (let k = 0; k <= n; k++) {
        const x = f.x0 + (f.x1 - f.x0) * k / n, z = f.z0 + (f.z1 - f.z0) * k / n;
        for (const d of [-0.75, -0.25, 0.25, 0.75]) {
          const [nx, nz] = f.side === 'N' ? [0, -1] : f.side === 'S' ? [0, 1] : f.side === 'W' ? [-1, 0] : [1, 0];
          const [cx, cy] = g.cellOf(x + nx * d, z + nz * d); const i = g.idx(cx, cy);
          cells.push(`${g.cells[i]}${g.blocked[i] ? 'b' : ''}${(g as unknown as {see?: Uint8Array}).see?.[i] ? 's' : ''}`);
        }
      }
      out.push(`shop ${s.name ?? s.id} lv ${s.level} side ${f.side} frontage ${JSON.stringify(f)} cells ${cells.join(' ')}`);
    }
    out.push('grid keys ' + Object.keys(layout.grid).join(','));
    out.push('shop keys ' + Object.keys(m.shops[0]).join(','));
    out.push('area keys ' + Object.keys(layout.areas[0]).join(',') + ' n ' + layout.areas.length);
    writeFileSync('/tmp/perf-m05/grid.txt', out.join('\n'));
  });
});
