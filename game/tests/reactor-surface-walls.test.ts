// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (primary): THE FLOATING WALLS (user screenshot: "strange
// floating walls on the surface"). The pit tiers' edge cells without a ceiling keep a nominal open band (floor + 40 m); the outdoor
// storey's band in the next column subtracted it only up to the open-sky band's top, so the rest stood over the yard as flat-bottomed,
// saw-toothed slabs (27.9 .. 40 m). world/levelGeometry.ts clipSkyFaces now stops every storey's faces at that top (a taller
// structure: its sky.tops), as it already did for the outdoor storey itself.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {LevelColumns, extractWallFaces, stationLevels} from '../src/world/levelGeometry';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';

describe('reactor surface: no storey under the roof stands above the open-sky band', () => {
  for (const seed of [9100, 4242, 777]) {
    it(`seed ${seed}: every wall face of every storey ends at sky.ceil (or a taller structure's top); the surface storey's own faces as before`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}) as StationLayout;
      const lv = stationLevels(L), sky = lv.find(l => l.sky)!.sky!;
      expect(sky.open && sky.outdoor).toBeTruthy();
      const faces = extractWallFaces(L, lv, new LevelColumns(lv), {tileLowerHeight: 1.8});
      const W = L.grid.w;
      const topAt = (f: (typeof faces)[number]) => {
        const bx = (f.x0 + f.x1) / 2 - f.nx * CELL / 2, bz = (f.z0 + f.z1) / 2 - f.nz * CELL / 2;
        const t = sky.tops ? sky.tops[Math.floor(bz / CELL) * W + Math.floor(bx / CELL)] : 0;
        return t > 0 ? Math.max(t, sky.ceil) : sky.ceil;
      };
      const over = faces.filter(f => f.level !== sky.outdoor!.level && f.y1 > topAt(f) + 1e-6);
      expect(over.map(f => `${f.level} ${f.y0.toFixed(1)}..${f.y1.toFixed(1)} @${f.x0.toFixed(0)},${f.z0.toFixed(0)}`)).toEqual([]);
      // the pit still has its walls (only what stood above the sky band went)
      expect(faces.filter(f => f.level !== sky.outdoor!.level && f.y1 > L.reactor!.pit.roofY - 1).length).toBeGreaterThan(0);
    }, 120_000);
  }
});
