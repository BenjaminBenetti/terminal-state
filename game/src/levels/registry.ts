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
import type {Arrival, LevelDef, LevelId, LevelTier, SectionGenContext, SectionKey} from './types';

export const LEVEL_IDS: readonly LevelId[] = ['subway', 'office'];

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
    tier: 0, // task track1-siren-blightbelly-20261031 (lane SPAWN): level 0 difficulty — the starting level
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
    tier: 1, // task track1-siren-blightbelly-20261031 (lane SPAWN): level 1 difficulty
    name: 'Office Space',
    blurb: 'A small subway stop under an office tower — climb the stairs into the lobby, then work up eight floors by stairwell or elevator.',
    entry: 'main',
    sections: () => ['main'],
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Office Space has no section '${section}'`);
      return withGear(generateOfficeLevel(ctx), ctx);
    },
  },
};

export function isLevelId(v: unknown): v is LevelId {
  return typeof v === 'string' && (LEVEL_IDS as readonly string[]).includes(v);
}

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): the difficulty tier of a registered level (types.ts LevelTier). Throws for an
 * unregistered id or a level without a valid tier — never a silent Subway / Office default (levels/levelContract.ts validates all).
 */
export function levelTier(id: LevelId): LevelTier {
  const def = isLevelId(id) ? LEVELS[id] : undefined;
  if (!def) throw new Error(`level '${String(id)}' is not registered`);
  if (!Number.isInteger(def.tier) || def.tier < 0) throw new Error(`level '${id}' has no valid tier (${String(def.tier)})`);
  return def.tier;
}

/** The other logical level (the pause menu's "Travel to …"). */
export function otherLevel(level: LevelId): LevelId {
  return level === 'subway' ? 'office' : 'subway';
}

/** Short human label of a level's world ("Station", "Station and tower"). */
export function sectionLabel(key: SectionKey): string {
  return key.level === 'office' ? 'Station and tower' : 'Station';
}

/** What the HUD calls clearing the level. */
export function clearLabel(key: SectionKey): string {
  return key.level === 'office' ? 'Tower clear' : 'Station clear';
}

/** Office storey label of a layout level id ('L' = lobby, '2'..'8'; '' for the station / non-office layouts). */
export function storeyLabel(layout: StationLayout, level: number): string {
  const s = layout.office?.storeys.find(t => t.levelId === level);
  return s ? s.label : '';
}

/** The player pose a level starts at: the office's platform start (layout.office.start), else layout.playerSpawn. */
export interface ArrivalPose { x: number; z: number; yaw: number; level?: number; y?: number; source: string }

export function arrivalPose(layout: StationLayout, _arrival: Arrival): ArrivalPose {
  const start = layout.office?.start;
  if (start) return {...start, source: 'start'};
  const sp = layout.playerSpawn as {x: number; z: number; yaw: number; level?: number; y?: number};
  return {x: sp.x, z: sp.z, yaw: sp.yaw, level: sp.level, y: sp.y, source: 'playerSpawn'};
}
