// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract): SURFACE RUN — a ruined surface district reached from a
// NEW / unvisited Subway, Office or Mall station. Pure (no three.js / DOM): the section key, the station's one seeded presence roll and
// the save-compatibility version lane.
//
// The district is a SECOND SECTION of its host station: SectionKey {level: <host archetype>, section: 'surface', station}. Its memory is
// `${station}:surface` (run/runState.ts), so a station's Retry scope, saves and lane stores carry it with the station's own 'main'
// section; it is generated from its own seed (surfaceSeed, never the host's station stream); nothing of it exists in the host's world
// (two separate worlds behind loading screens — Game.crossSurface).
//
// Presence: ONE deterministic roll per host station (surfaceRoll: a pure hash of the station's level seed on its own salt — independent of
// the Beyond-the-Station area roll, the roster rolls and every generation stream), present below SURFACE_CHANCE on the three host
// archetypes only. It is applied only where the station's recorded SURFACE VERSION allows it (surfaceVersionFor): a station first built
// before this feature (memory with visits, no record) stays at version 0 — no access, no district, its layout / enemies / kills / loot
// exact; a station never entered gets SURFACE_VERSION, stamped on its 'main' memory at its first generation (Game.generateSection).

import type {LevelId, SectionKey} from '../../levels/types';
import {Rng, hashString} from '../../core/rng';

/** The district's section id (SectionKey.section). The host station's own world stays 'main'. */
export const SURFACE_SECTION = 'surface';

/** The host archetypes that can carry the district (campaign / QA archetypes). */
export const SURFACE_HOSTS = ['subway', 'office', 'mall'] as const;
export type SurfaceHost = typeof SURFACE_HOSTS[number];

/** The presence chance per new / unvisited host station (user: "An independent deterministic 25% roll"). */
export const SURFACE_CHANCE = 0.25;
/** The presence roll's own salt (never shared with another roll). */
export const SURFACE_ROLL_SALT = 'surface-run-presence-v1';
/** The district seed's salt (the district's generation streams derive from it, never from the host's). */
export const SURFACE_SEED_SALT = 'surface-run-district-v1';

/** Lane store on the HOST station's 'main' memory: the surface version the station was first generated with ({v}). */
export const SURFACE_LANE = 'surface.run';
/**
 * Current surface version: 0 = no Surface Run (a station visited before it existed), 1 = the first release, 2 = the field follow-up
 * (task studio-surface-run-field-followup-20261116-211729-01: see surfaceFeatures). A station keeps the version it was first generated
 * with forever (surfaceVersionFor); its district follows the HOST's record (districtVersionOf), so a v1 world regenerates exactly.
 */
export const SURFACE_VERSION = 2;

/**
 * What a surface version builds (task studio-surface-run-field-followup-20261116-211729-01, primary contract). Every STRUCTURAL / access /
 * interior change of the follow-up is gated here so a version-1 host station and its district stay byte-identical (tests/
 * surface-v1-compat.test.ts pins them); runtime fixes (doors, glass, truck damage / repair, the truck's dash map, the depot's one-unit
 * seeding of a not-yet-seeded depot) apply to every version.
 */
export function surfaceFeatures(version: number | undefined): {
  /**
   * The SUBWAY's crossing is a cargo-lift ride (both directions) between a lift at its closed street exit and one inside the command tent
   * (the Office / Mall: `connector`).
   */
  lift: boolean;
  /**
   * (task studio-surface-host-ground-connectors-20261118-053602-01) An OFFICE / MALL host's crossing is walked on foot through one level
   * canvas tube from its version-1 street doorway to the command tent (gen/surface/connectorShape.ts; gen/surface/accessConnector.ts).
   */
  connector: boolean;
  /** The Subway's way up is at a normal closed street exit (never off the food court). */
  closedExitAccess: boolean;
  /** The district side arrives inside the command tent (gas-free) whose doorway is a real walk-through opening. */
  tentArrival: boolean;
  /** No visible perimeter wall: thickening outer fog, filler blocks and the fog-pressure boundary (world/surface/fogPressure.ts). */
  fogBoundary: boolean;
  /** Deeper enterable destinations: public / back rooms, connected storeys, stairs, landings and reachable roofs. */
  deepInteriors: boolean;
} {
  const v2 = (version ?? 0) >= 2;
  return {lift: v2, connector: v2, closedExitAccess: v2, tentArrival: v2, fogBoundary: v2, deepInteriors: v2};
}

export function isSurfaceHost(level: LevelId): level is SurfaceHost {
  return (SURFACE_HOSTS as readonly string[]).includes(level);
}

/** The station's presence roll in [0, 1): a pure hash of its LOGICAL level seed (never an attempt seed; a retry rolls the same). */
export function surfaceRoll(levelSeed: number): number {
  return new Rng(hashString(SURFACE_ROLL_SALT, levelSeed >>> 0)).next();
}

/** Does this station carry Surface Run (host archetype, version >= 1, roll below the chance)? */
export function surfacePresent(level: LevelId, levelSeed: number, version: number | undefined): boolean {
  return (version ?? 0) >= 1 && isSurfaceHost(level) && surfaceRoll(levelSeed) < SURFACE_CHANCE;
}

/** The district's own generation seed (derived from the host station's level seed on its own salt). */
export function surfaceSeed(levelSeed: number): number {
  return hashString(SURFACE_SEED_SALT, levelSeed >>> 0) >>> 0;
}

/**
 * The surface version a host station generates with — the gen/skyways/layoutVersion.ts / ai/enemyRoster.ts pattern: its recorded
 * {v} when valid; a station ENTERED before the feature (visits > 0, no record) stays 0 forever; a station never entered gets the current.
 */
export function surfaceVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[SURFACE_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 0 && rec.v <= SURFACE_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 0 : SURFACE_VERSION;
}

/**
 * The version a DISTRICT generates with: its host station's recorded version (SectionGenContext.surfaceVersion as the game passes it for
 * the 'surface' section: Game.sectionGenInputs reads the HOST's memory). Absent (a direct generator call, the older tests and fixtures)
 * = 1, the first release's district; a district exists only for version >= 1, so anything lower is read as 1. Never above the current.
 */
export function districtVersionOf(surfaceVersion: number | undefined): number {
  const v = surfaceVersion ?? 1;
  return Number.isInteger(v) ? Math.min(SURFACE_VERSION, Math.max(1, v)) : 1;
}

export function isSurfaceKey(k: SectionKey | null | undefined): boolean {
  return !!k && k.section === SURFACE_SECTION;
}

/** The district key of a host station key. */
export function surfaceKeyOf(host: SectionKey): SectionKey {
  return host.station ? {level: host.level, section: SURFACE_SECTION, station: host.station} : {level: host.level, section: SURFACE_SECTION};
}

/** The host station's own ('main') key of a district key. */
export function hostKeyOf(surface: SectionKey): SectionKey {
  return surface.station ? {level: surface.level, section: 'main', station: surface.station} : {level: surface.level, section: 'main'};
}

/**
 * The ASSET family a section loads under (assets/levelAssets.ts selectLevelKeys / foreignTo / LevelResources.retainOnly): the district
 * is its own family 'surface' (its own surface-* files plus the shared ones and the families whose rules allow it), never its host's.
 */
export function sectionAssetLevel(key: SectionKey): string {
  return isSurfaceKey(key) ? 'surface' : key.level;
}
