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

// (lane PLANT found it; primary fixed it) the wet film's 1 m cells were deduped by the WHOLE cell, so where a cell straddled two walk
// rects the second rect's half stayed dry: 0.5 m dry strips across the plaza. Every walk point outside the opening's keep-off distance
// and the shelters is under the film now.
describe('reactor surface: the wet film covers the whole open walk (no dry strips along walk-rect boundaries)', async () => {
  const {surfaceSiteOf} = await import('../src/world/reactor/surfaceSite');
  const {filmGeometry} = await import('../src/world/reactor/surfaceCity');
  for (const seed of [9100, 4242]) {
    it(`seed ${seed}`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}) as StationLayout;
      const site = surfaceSiteOf(L)!, g = filmGeometry(site)!, pos = g.attributes.position;
      const cells: [number, number, number, number][] = [];
      for (let i = 0; i < pos.count; i += 6) {
        const xs = [0, 1, 2, 3, 4, 5].map(k => pos.getX(i + k)), zs = [0, 1, 2, 3, 4, 5].map(k => pos.getZ(i + k));
        cells.push([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]);
      }
      const o = site.hole, keep = Math.max(o.keepR, o.r + 0.6);
      let dry = 0, n = 0;
      for (const r of site.walk) for (let z = r.z0 + 0.13; z < r.z1; z += 0.25) for (let x = r.x0 + 0.13; x < r.x1; x += 0.25) {
        if (Math.hypot(x - o.x, z - o.z) < keep + 1.5 || site.shelters.some(s => x >= s.rect.x0 - 1 && x <= s.rect.x1 + 1 && z >= s.rect.z0 - 1 && z <= s.rect.z1 + 1)) continue;
        n++;
        if (!cells.some(c => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3])) dry++;
      }
      expect(n).toBeGreaterThan(1000);
      expect(dry).toBe(0);
    }, 120_000);
  }
});

// Task studio-alpha-reactor-ending-polish-20261104-034806-01 (primary; user: "there is a flat piece of ground you walk through as you go
// the the stairs to the surface"): the city's ground disc (a one-sided visual plane 3 cm under the deck) crossed the exit stair's top
// flights inside the head house; seen once the eye rose above it, a flat floor at foot height. It is cut there now; beyond the head house
// the flights stay underground under the disc (no hole into the stair shaft), and the ground round the head house is intact.
describe('reactor surface: the ground disc leaves the stairwell open under the head house (and only there)', async () => {
  const {surfaceSiteOf} = await import('../src/world/reactor/surfaceSite');
  const {groundGeometry, stairwellRect} = await import('../src/world/reactor/surfaceCity');
  for (const seed of [9100, 4242, 777]) {
    it(`seed ${seed}`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}) as StationLayout;
      const site = surfaceSiteOf(L)!, well = stairwellRect(site)!;
      expect(well).not.toBeNull();
      const st = site.stairs!.rect, head = site.shelters[0].rect;
      // the cut is the stair's footprint inside the head house
      expect(well).toEqual({x0: Math.max(st.x0, head.x0), z0: Math.max(st.z0, head.z0), x1: Math.min(st.x1, head.x1), z1: Math.min(st.z1, head.z1)});
      const g = groundGeometry(site, {groundR: 345}), pos = g.attributes.position, idx = g.index;
      const tris: number[][] = [];
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) { const v = [0, 1, 2].map(k => (idx ? idx.getX(t + k) : t + k)); tris.push(v.flatMap(i => [pos.getX(i), pos.getZ(i)])); }
      const covered = (x: number, z: number) => tris.some(([ax, az, bx, bz, cx, cz]) => {
        const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
        return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      });
      for (let x = well.x0 + 0.25; x < well.x1; x += 0.5) for (let z = well.z0 + 0.25; z < well.z1; z += 0.5) expect(covered(x, z), `in the well ${x},${z}`).toBe(false);
      // outside the head house over the stair's footprint (the underground flights) and round the head house: ground as before
      const out: [number, number][] = [];
      for (let x = st.x0 + 0.25; x < st.x1; x += 0.5) for (let z = st.z0 + 0.25; z < st.z1; z += 0.5) if (x < head.x0 || x > head.x1 || z < head.z0 || z > head.z1) out.push([x, z]);
      for (const [dx, dz] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) out.push([(head.x0 + head.x1) / 2 + dx * (head.x1 - head.x0) / 2, (head.z0 + head.z1) / 2 + dz * (head.z1 - head.z0) / 2]);
      expect(out.length).toBeGreaterThan(4);
      for (const [x, z] of out) expect(covered(x, z), `ground at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      // the aperture is still cut (one opening) and the disc is otherwise whole
      expect(covered(site.hole.x, site.hole.z)).toBe(false);
    }, 120_000);
  }
});
