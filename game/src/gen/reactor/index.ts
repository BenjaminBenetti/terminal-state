// Task reactor-build-20261101 (lane GEN): THE REACTOR (LevelId 'reactor', tier 3) — the WHOLE pit as ONE continuous StationLayout:
// `generateReactorLevel(ctx)`. Contract: gen/reactor/reactorTypes.ts (layout.reactor). STUB until lane GEN lands the generator.

import type {SectionGenContext} from '../../levels/types';
import type {StationLayout} from '../stationTypes';
import type {LootProfile} from '../../items/lootTables';
import type {SpawnProfile} from '../../ai/spawnTables';
import type {TrackExtConfig} from '../trackExt/types';

export interface ReactorGenOptions {
  /** Force a named kit variant (tests / QA); default: the level seed's. */
  variant?: string;
  loot?: LootProfile;
  spawns?: SpawnProfile;
  /** The level's track-extension declaration (LEVELS.reactor.trackExtensions); 'none' = no extensions. */
  trackExt?: TrackExtConfig | 'none';
}

/** The ONE continuous Reactor layout (rim station + walkway tiers + core floor + layout.reactor). */
export function generateReactorLevel(_ctx: SectionGenContext, _opts: ReactorGenOptions = {}): StationLayout {
  throw new Error('reactor level generator not implemented yet (lane GEN)');
}
