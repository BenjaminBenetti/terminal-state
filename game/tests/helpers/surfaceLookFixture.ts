// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): a district layout for the look tests — the contract skeleton
// (gen/surface/index.ts, the real 8 x 8 frame and grid) ENRICHED with what lane GEN publishes, so every look path is exercised before
// GEN lands: every facade style id (LOOK_FACADE_IDS), every condition, varied storeys / programmes, AIR window spans (every pane
// state) on the interiors' street walls, a destination name. Deterministic; built once per seed (the plan is memoized per layout).

import {CELL, SOLID} from '../../src/gen/grid';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {SurfaceBuildingKind, SurfaceCondition, SurfaceWindowSpan} from '../../src/gen/surface/surfaceTypes';
import {LEVELS} from '../../src/levels/registry';
import {FACADE_STYLES, LOOK_FACADE_IDS, type LookFacadeId} from '../../src/world/surface/archStyles';

/** Facade id -> a building kind / programme it suits (the interior family follows the programme). */
const KIND_OF: Readonly<Record<LookFacadeId, [SurfaceBuildingKind, string]>> = {
  'brick-retail': ['store', 'hardware'], 'brick-residential': ['residential', 'walk-up-apartments'], 'stucco': ['store', 'corner-deli'],
  'concrete-office': ['office', 'insurance-office'], 'glass-office': ['office', 'office-tower'], 'precast-centre': ['centre', 'strip-centre'],
  'industrial-shed': ['industrial', 'warehouse'], 'civic-stone': ['civic', 'public-library'], 'transit-headhouse': ['civic', 'subway-entrance'],
  'tent-canvas': ['civic', 'command-post'],
} as const;

const CONDITIONS: readonly SurfaceCondition[] = ['intact', 'damaged', 'gutted', 'collapsed'];

export interface LookFixture {
  layout: StationLayout;
  /** Facade id per building index. */
  facades: LookFacadeId[];
  /** The added AIR span ids. */
  spans: string[];
}

const cache = new Map<number, LookFixture>();

/** The enriched district (one per seed). */
export function lookFixture(seed = 93): LookFixture {
  const hit = cache.get(seed);
  if (hit) return hit;
  const layout = LEVELS.subway.generate('surface', {levelSeed: seed});
  const S = layout.surface!;
  const g = layout.grid;
  const facades: LookFacadeId[] = [];
  const spans: string[] = [];
  // the styles a closed shell can wear (the tent is the checkpoint's: LOOK draws it from the checkpoint record)
  const shellIds = LOOK_FACADE_IDS.filter(id => id !== 'tent-canvas');
  S.buildings.forEach((b, k) => {
    const id = b.kind === 'depot' ? 'industrial-shed' : shellIds[k % shellIds.length];
    facades.push(id);
    const [kind, programme] = KIND_OF[id];
    if (b.kind !== 'depot') { b.kind = kind; b.programme = programme; }
    b.facade = id;
    const st = FACADE_STYLES[id];
    // enterable shells stay standing (their interior carries a ceiling); the others cycle through every condition
    b.condition = b.enterable ? (k % 3 === 0 ? 'damaged' : 'intact') : CONDITIONS[k % CONDITIONS.length];
    b.storeys = b.enterable ? 2 + (k % 3) : 1 + (k % 6);
    b.height = Math.max(b.storeys * st.storey + st.parapet, 4);
    // every 5th closed shell carries GEN's shape record: uneven storeys standing on the kerb (0.15 m), the roof / top absolute
    if (!b.enterable && k % 5 === 0 && b.storeys >= 3) {
      const sh = Array.from({length: b.storeys}, (_, j) => (j === 0 ? st.storey + 0.9 : st.storey));
      const g = b as typeof b & {storeyHeights?: number[]; parapet?: number; roofY?: number};
      g.storeyHeights = sh;
      g.parapet = st.parapet;
      g.roofY = Math.round((0.15 + sh.reduce((a, c) => a + c, 0)) * 100) / 100;
      b.height = g.roofY + st.parapet;
    }
    if (b.destination && !b.name) b.name = `Calder ${programme}`;
  });
  // AIR spans on every interior's street wall (the skeleton's walls are one cell thick), every pane state
  const panes: SurfaceWindowSpan['panes'] = ['intact', 'cracked', 'broken', 'boarded'];
  for (const b of S.buildings) {
    if (!b.enterable || !b.areas.length) continue;
    const fp = b.footprint, e = b.entrances[0];
    const x0 = (e ? e.x : (fp.x0 + fp.x1) / 2) + 3, x1 = x0 + 4.8;
    if (x1 > fp.x1 - 1.5) continue;
    const zc = Math.floor((fp.z1 - CELL / 2) / CELL), ok = (() => { for (let x = Math.floor(x0 / CELL); x < Math.ceil(x1 / CELL); x++) if (g.cells[zc * g.w + x] !== SOLID) return false; return true; })();
    if (!ok) continue;
    const id = `b${b.id}-w0`;
    S.windows.push({id, building: b.id, level: 0, x0, z0: fp.z1 - CELL, x1, z1: fp.z1, side: 'S', sill: 0.95, head: 2.35, panes: [...panes], room: b.areas[0], shop: b.kind === 'store'});
    b.windows.push(id);
    spans.push(id);
  }
  const f = {layout, facades, spans};
  cache.set(seed, f);
  return f;
}

/** A plain (non-district) layout: the Subway's main station. */
export function plainLayout(seed = 93): StationLayout {
  return LEVELS.subway.generate('main', {levelSeed: seed});
}
