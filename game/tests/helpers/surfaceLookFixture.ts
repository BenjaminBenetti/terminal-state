// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): a district layout for the look tests — GEN's REAL district
// (LEVELS.subway.generate('surface')), filled in only where a seed lacks something a look path needs: a facade style GEN did not roll
// this time is given to a few ordinary shells (their own storeys kept), and a district without ROOMS' window spans gets a span per
// interior street wall (every pane state). Deterministic; built once per seed (the plan is memoized per layout).

import {CELL, SOLID} from '../../src/gen/grid';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {SurfaceWindowSpan} from '../../src/gen/surface/surfaceTypes';
import {LEVELS} from '../../src/levels/registry';
import {LOOK_FACADE_IDS, type LookFacadeId} from '../../src/world/surface/archStyles';

export interface LookFixture {
  layout: StationLayout;
  /** Facade id per building index. */
  facades: LookFacadeId[];
  /** The window span ids (ROOMS', else the added ones). */
  spans: string[];
  /** Facade ids this fixture assigned (absent from GEN's roll for this seed). */
  filled: LookFacadeId[];
}

const cache = new Map<number, LookFixture>();

/** The district (one per seed). */
export function lookFixture(seed = 93): LookFixture {
  const hit = cache.get(seed);
  if (hit) return hit;
  const layout = LEVELS.subway.generate('surface', {levelSeed: seed});
  const S = layout.surface!;
  const g = layout.grid;
  // every closed-shell style drawn at least once: a missing one goes to ordinary (non-host, non-depot, non-destination) shells
  const present = new Set(S.buildings.map(b => b.facade));
  const filled = LOOK_FACADE_IDS.filter(id => id !== 'tent-canvas' && id !== 'transit-headhouse' && !present.has(id));
  const donors = S.buildings.filter(b => !b.host && b.kind !== 'depot' && !b.destination && !b.enterable);
  filled.forEach((id, k) => { for (const b of donors.filter((_, j) => j % Math.max(1, filled.length) === k).slice(0, 2)) b.facade = id; });
  // window spans: ROOMS' when published, else one per interior street wall (the wall one cell thick), every pane state
  const spans = S.windows.map(w => w.id);
  if (!spans.length) {
    const panes: SurfaceWindowSpan['panes'] = ['intact', 'cracked', 'broken', 'boarded'];
    for (const b of S.buildings) {
      if (!b.enterable || !b.areas.length || b.host) continue;
      const fp = b.footprint, e = b.entrances[0];
      const x0 = (e ? e.x : (fp.x0 + fp.x1) / 2) + 3, x1 = x0 + 4.8;
      if (x1 > fp.x1 - 1.5) continue;
      const zc = Math.floor((fp.z1 - CELL / 2) / CELL);
      let ok = true;
      for (let x = Math.floor(x0 / CELL); x < Math.ceil(x1 / CELL); x++) if (g.cells[zc * g.w + x] !== SOLID || g.cells[(zc - 1) * g.w + x] === SOLID) ok = false;
      if (!ok) continue;
      const id = `b${b.id}-w0`;
      S.windows.push({id, building: b.id, level: 0, x0, z0: fp.z1 - CELL, x1, z1: fp.z1, side: 'S', sill: 0.95, head: 2.35, panes: [...panes], room: b.areas[0], shop: b.kind === 'store'});
      b.windows.push(id);
      spans.push(id);
    }
  }
  const f = {layout, facades: S.buildings.map(b => b.facade as LookFacadeId), spans, filled};
  cache.set(seed, f);
  return f;
}

/** A plain (non-district) layout: the Subway's main station. */
export function plainLayout(seed = 93): StationLayout {
  return LEVELS.subway.generate('main', {levelSeed: seed});
}
