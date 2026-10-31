// Iteration 16 (lane RUN) / iteration 17 (seamless): the logical levels of the game (levels/types.ts). Each level is ONE
// continuous world, section 'main':
//  - subway: generateStation(levelSeed, {startWeapon}) with ZERO changes to its output; the level-wide gear roll (lane GEAR)
//    is appended to layout.pickups afterwards (no gear => identical).
//  - office: lane GEN's generateOfficeLevel(ctx) — the compact station, the tower lobby and office floors 2–8 at their real
//    heights in one layout (stairs + a moving elevator between them; nothing inside the level is a travel).
// A level regenerates identically from its seed: the run memory (run/memory.ts) carries what changed.

import {generateStation} from '../gen/station';
import type {StationLayout} from '../gen/stationTypes';
import {isMaskLootItem, placeMaskLoot, placeSectionGear} from './gearAdapter';
import {generateOfficeLevel} from '../gen/office/index'; // lane GEN
import {generateMallLevel} from '../gen/mall/index'; // Task track3-eaton-centre-20261031 (lane GEN): The Eaton's Center
import {MALL_TRACK_EXTENSIONS, type TrackExtConfigInterim} from '../gen/mall/trackExt'; // (lane GEN: Track2 interim declaration)
import type {Arrival, LevelDef, LevelId, SectionGenContext, SectionKey} from './types';

/** Logical levels in tier order (subway 0, office 1, mall 2 — task track3-eaton-centre-20261031, lane GEN). */
export const LEVEL_IDS: readonly LevelId[] = ['subway', 'office', 'mall'];

/**
 * Gear of the level-wide roll (lane GEAR), placed once, after generation. Task gasmask-breach-20261030 (mask lane): the roll's
 * gas masks / filters (gen/maskLoot.ts, appended to it by levels/gearAdapter.ts) are placed AFTER the gear with their own rng,
 * so every gear placement is exactly what it was.
 */
function withGear(layout: StationLayout, ctx: SectionGenContext): StationLayout {
  if (ctx.gear && ctx.gear.length) {
    placeSectionGear(layout, ctx.gear.filter(g => !isMaskLootItem(g.itemId)));
    placeMaskLoot(layout, ctx.gear.filter(g => isMaskLootItem(g.itemId)));
  }
  return layout;
}

export const LEVELS: Record<LevelId, LevelDef> = {
  subway: {
    id: 'subway',
    name: 'Subway',
    blurb: 'A large abandoned subway station — platforms, concourses, shops and back-of-house rooms.',
    entry: 'main',
    sections: () => ['main'],
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Subway has no section '${section}'`);
      return withGear(generateStation(ctx.levelSeed >>> 0, {startWeapon: ctx.startWeapon}), ctx);
    },
  },
  office: {
    id: 'office',
    name: 'Office Space',
    blurb: 'A small subway stop under an office tower — climb the stairs into the lobby, then work up eight floors by stairwell or elevator.',
    entry: 'main',
    sections: () => ['main'],
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Office Space has no section '${section}'`);
      return withGear(generateOfficeLevel(ctx), ctx);
    },
  },
  // Task track3-eaton-centre-20261031 (lane GEN): THE EATON'S CENTER — a subway station at the bottom of an open pit under a glass
  // roof, six retail rings around the void (gen/mall/index.ts). ONE continuous world, section 'main'.
  mall: {
    id: 'mall',
    name: "The Eaton's Center",
    blurb: 'A subway station at the bottom of a vast open mall — look up through six rings of shops to the glass roof, then work your way up by escalator, stairs and bridges.',
    entry: 'main',
    sections: () => ['main'],
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`The Eaton's Center has no section '${section}'`);
      return withGear(generateMallLevel(ctx), ctx);
    },
  },
};

/**
 * Task track3-eaton-centre-20261031 (lane GEN): Track2 (same-world track extensions / service annexes) — each track-bearing level's
 * declaration. INTERIM data hook until Track2's `trackExtensions: TrackExtConfig | 'none'` lands (then it moves into LevelDef):
 * the mall is ENABLED; the Subway / Office are Track2's to declare (absent here = not yet declared).
 */
export const TRACK_EXTENSIONS: Partial<Record<LevelId, TrackExtConfigInterim | 'none'>> = {
  mall: MALL_TRACK_EXTENSIONS,
};

export function isLevelId(v: unknown): v is LevelId {
  return typeof v === 'string' && (LEVEL_IDS as readonly string[]).includes(v);
}

/**
 * The default other logical level (the pause menu's first "Travel to …"; task track3-eaton-centre-20261031, lane GEN: with three
 * levels the menus offer every level in `travelTargets`). Subway <-> Office as before; the mall's default is the Subway.
 */
export function otherLevel(level: LevelId): LevelId {
  return level === 'subway' ? 'office' : 'subway';
}

/** Every level a menu can travel to from `level` (tier order, the current level excluded). */
export function travelTargets(level: LevelId): LevelId[] {
  return LEVEL_IDS.filter(l => l !== level);
}

/** Short human label of a level's world ("Station", "Station and tower", "Station and mall"). */
export function sectionLabel(key: SectionKey): string {
  return key.level === 'office' ? 'Station and tower' : key.level === 'mall' ? 'Station and mall' : 'Station';
}

/** What the HUD calls clearing the level. */
export function clearLabel(key: SectionKey): string {
  return key.level === 'office' ? 'Tower clear' : key.level === 'mall' ? 'Mall clear' : 'Station clear';
}

/**
 * Storey label of a layout level id: the office's ('L' = lobby, '2'..'8'); the mall's ('Subway', 'Level 1' … 'Level 6'; lane GEN,
 * task track3-eaton-centre-20261031); '' for the Subway.
 */
export function storeyLabel(layout: StationLayout, level: number): string {
  const s = layout.office?.storeys.find(t => t.levelId === level);
  if (s) return s.label;
  const m = layout.mall?.storeys.find(t => t.level === level);
  return m ? m.label : '';
}

/** The player pose a level starts at: the office's platform start (layout.office.start), else layout.playerSpawn. */
export interface ArrivalPose { x: number; z: number; yaw: number; level?: number; y?: number; source: string }

export function arrivalPose(layout: StationLayout, _arrival: Arrival): ArrivalPose {
  const start = layout.office?.start ?? layout.mall?.start; // (lane GEN: + the mall's platform start)
  if (start) return {...start, source: 'start'};
  const sp = layout.playerSpawn as {x: number; z: number; yaw: number; level?: number; y?: number};
  return {x: sp.x, z: sp.z, yaw: sp.yaw, level: sp.level, y: sp.y, source: 'playerSpawn'};
}
