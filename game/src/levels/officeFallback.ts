// Iteration 16 (lane RUN) — TEMPORARY STAND-IN for lane WORLD-GEN's office generator (gen/office/index.ts
// generateOfficeSection). It only exists so the multi-level run / travel plumbing compiles and can be exercised before
// the real office lands: every office section is an ordinary generated station from a seed derived from the level seed
// and the section name (no tower, no elevator, no layout.office => arrivals fall back to playerSpawn).
// TODO(RUN): when gen/office/index.ts exists, levels/registry.ts imports generateOfficeSection from there and this file
// is deleted.

import {hashString} from '../core/rng';
import {generateStation} from '../gen/station';
import type {StationLayout} from '../gen/stationTypes';
import type {SectionGenContext} from './types';

export function generateOfficeSection(section: string, ctx: SectionGenContext): StationLayout {
  const layout = generateStation(hashString(`office:${section}`, ctx.levelSeed >>> 0), {startWeapon: ctx.startWeapon});
  layout.name = section === 'street' ? `${layout.name} (office street, placeholder)` : `Office ${section.replace('floor-', 'floor ')} (placeholder)`;
  return layout;
}
