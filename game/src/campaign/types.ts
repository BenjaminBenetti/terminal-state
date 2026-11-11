// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary, SHARED CONTRACT — lanes build on these types, only the
// primary changes them): the CAMPAIGN — a run is a journey across a seeded, subway-like NETWORK of ~40 stations, travelled by the
// player's own train. Every network node is its OWN persistent world.
//
// Identity: a StationId names ONE node (one world, one seed, its own loot / enemies / objectives / dead state); its `archetype`
// (a LevelId: 'subway' | 'office' | 'mall' | 'market' | 'bunker' | 'skyways' | 'reactor') only says WHICH generator builds it. Two Subway nodes are two different
// worlds. Section memory / lane stores are keyed by the station (`sectionId({level, section, station})` = `${station}:${section}`).
//
// Seeds: the network has its own `seed` (graph layout, names, archetypes) and every node a `levelSeed` derived from it by a
// dedicated hash (never from a level's internal PRNG): revisiting a node regenerates exactly the same world; a new game rolls a
// fresh network seed.

import type {LevelId} from '../levels/types';

/** One network node's id: `st-00` .. `st-NN` (stable within a network; the start is `st-00`). */
export type StationId = string;

/**
 * Ordinary station archetypes and their configured weights (user 2026-11-02: 80 / 10 / 10; future archetypes take Subway's share).
 * Task studio-skyways-level-20261106-054448-01 (user: "10 % ... taken from default Subway levels"): + Skyways 10 % out of the Subway's
 * share — 70 / 10 / 10 / 10: of the 39 ordinary nodes 27 Subway (incl. the start), 4 Office, 4 Mall, 4 Skyways (Office / Mall unchanged).
 * Task studio-survivor-market-20261108-005807-01 (lane LEVEL; user: "5% map allocation from Subway ONLY"): + the Survivor Market 5 % out
 * of the Subway's share — 65 / 10 / 10 / 10 / 5: of the 39 ordinary nodes 25 Subway (incl. the start), 4 Office, 4 Mall, 4 Skyways,
 * 2 Market (largest remainder; the non-Subway shares unchanged).
 * Task studio-bunker-level-20261109-072224-01 (lane LEVEL; user: a 5 % network allocation ONLY from the basic Subway weight): + the Bunker
 * 5 % out of the Subway's share, APPENDED LAST — 60 / 10 / 10 / 10 / 5 / 5: of the 39 ordinary nodes 23 Subway (incl. the start), 4 Office,
 * 4 Mall, 4 Skyways, 2 Market, 2 Bunker (largest remainder; the market / bunker tie goes by key order). Appended last, the special-node
 * placement draws of the earlier archetypes are unchanged for a network seed: two of its Subway nodes become Bunkers.
 */
export const ORDINARY_WEIGHTS: Readonly<Record<Exclude<LevelId, 'reactor'>, number>> = {subway: 0.6, office: 0.1, mall: 0.1, skyways: 0.1, market: 0.05, bunker: 0.05};
/**
 * Task studio-bunker-level-20261109-072224-01 (lane LEVEL): the weights every network generated BEFORE the Bunker was drawn with
 * (25 / 4 / 4 / 4 / 2, no bunker). Saved networks are never regenerated (validateNetwork accepts every census below): an existing campaign
 * keeps its worlds — no visited Subway world turns into a Bunker; Bunker nodes appear in campaigns started on this build.
 */
export const PRE_BUNKER_WEIGHTS: Readonly<Partial<Record<Exclude<LevelId, 'reactor'>, number>>> = {subway: 0.65, office: 0.1, mall: 0.1, skyways: 0.1, market: 0.05};
/**
 * Task studio-survivor-market-20261108-005807-01 (lane LEVEL): the weights every network generated BEFORE the Survivor Market was drawn
 * with (27 / 4 / 4 / 4 / 0). Saved networks are never regenerated (validateNetwork accepts every census below): an existing campaign keeps
 * its worlds — no visited Subway world turns into a market; market nodes appear in campaigns started on this build.
 */
export const PRE_MARKET_WEIGHTS: Readonly<Partial<Record<Exclude<LevelId, 'reactor'>, number>>> = {subway: 0.7, office: 0.1, mall: 0.1, skyways: 0.1};
/**
 * The weights every network generated BEFORE Skyways was drawn with (31 / 4 / 4 / 0). Saved networks are never regenerated: a save
 * written by an older build keeps its network (validateNetwork accepts either census), so an existing campaign never turns a visited
 * Subway world into Skyways; Skyways nodes appear in campaigns started on this build.
 */
export const PRE_SKYWAYS_WEIGHTS: Readonly<Partial<Record<Exclude<LevelId, 'reactor'>, number>>> = {subway: 0.8, office: 0.1, mall: 0.1};

/** Network size: ~40 nodes = 39 ordinary (largest remainder of the weights: 23 Subway incl. the start, 4 Office, 4 Mall, 4 Skyways, 2 Market, 2 Bunker) + exactly 1 Reactor. */
export const NETWORK_SIZE = {ordinary: 39, reactor: 1} as const;

/** A station of the network. */
export interface StationNode {
  id: StationId;
  /** Printed name ("Calder Park"). Unique within the network. */
  name: string;
  archetype: LevelId;
  /** This node's world seed (StationNode-specific; hashNodeSeed(network.seed, id)). */
  levelSeed: number;
  /** Map position in abstract map units (the paper map fits / scales them; ~0..100 each axis). */
  x: number;
  y: number;
  /** Ids of the lines serving this node (>= 1; > 1 = an interchange). */
  lines: string[];
}

/** A line of the network: an ordered path of stations (a branch is its own line sharing a junction node). */
export interface NetworkLine {
  id: string;
  /** Printed line name ("Red Line"). */
  name: string;
  /** Printed ink colour (#rrggbb). */
  color: string;
  /** Ordered station ids along the line (consecutive pairs are track edges). */
  stations: StationId[];
  /** True when the line closes on itself (a loop). */
  loop?: boolean;
}

/** The whole network (immutable once generated; serialized in saves). */
export interface SubwayNetwork {
  v: 1;
  seed: number;
  nodes: StationNode[];
  /** Undirected track connections (each pair once, sorted ids). */
  edges: [StationId, StationId][];
  lines: NetworkLine[];
  /** The first station (always a Subway node). */
  start: StationId;
  /** The ONE Reactor node: the win destination. */
  reactor: StationId;
}

/** A train journey in progress (the transit is an autosave point; a reload resumes it once). */
export interface PendingTransit {
  from: StationId;
  to: StationId;
  /** 'departing' = committed at the departure autosave; 'arrived' is never stored (the arrival autosave clears the transit). */
  phase: 'departing';
  /** True when chosen with the 1337 map cheat (any node, no adjacency needed). */
  cheat: boolean;
  /**
   * Task campaign-polish-20261103-063841 (lane MAP): a MULTI-HOP journey's route, [from, ..., to] (>= 3 stations; consecutive pairs
   * are track edges; every station after `from` KNOWN — task gameplay-feedback-20261111 lane TRAVEL, was VISITED — and an unvisited
   * Reactor never passed). Absent for a one-hop trip and for a cheat trip (old saves: absent). ONE continuous ride: only `to` is ever
   * built / arrived at (and marked visited); the intermediate stations are passed in the tunnel, never loaded or visited.
   */
  route?: StationId[];
  /**
   * Task studio-beta-train-fuel-system-20261106-024923-01: the journey's fuel, charged ONCE when it departed (fuel/fuel.ts): `cost` quarter
   * units (hops x 4; 0 = the map cheat) and exactly what was drawn (`debit`: refunded only when the journey fails back to `from`). A
   * reload of the departure save resumes the journey without charging again. Absent in older saves (their journeys resume free).
   */
  fuel?: {cost: number; debit: import('../fuel/fuel').FuelDebit};
}

/** The run's campaign record (serialized in saves). */
export interface CampaignState {
  v: 1;
  network: SubwayNetwork;
  /** Where the player's train stands now (during a transit: the station being LEFT until the arrival commits). */
  current: StationId;
  /** Stations shown on the map (the start at first; the console reveals current + one hop). */
  known: StationId[];
  /** Stations the player has arrived at. */
  visited: StationId[];
  /** The map cheat (1337 while the map is open): reveals the whole network and allows travel to any node — THIS run only. */
  cheat: boolean;
  /** The run is won (the Reactor's ending); exploration continues. */
  won: {at: string; station: StationId; via: string} | null;
  transit: PendingTransit | null;
}

/** Number of save slots (localStorage, this browser + origin). */
export const SAVE_SLOTS = 3;

/** localStorage key prefix of the save slots / the settings (settings are stored separately from runs). */
export const STORAGE_KEYS = {
  slot: (n: number) => `terminal-state.save.slot${n}.v1`,
  lastSlot: 'terminal-state.save.last.v1',
  settings: 'terminal-state.settings.v1',
} as const;

/** Human-readable slot metadata (also inside the save file). */
export interface SaveMeta {
  slot: number;
  /** ISO time of the last committed write. */
  savedAt: string;
  /** Monotonic per-slot revision (concurrent tabs: a write never replaces a newer revision silently). */
  revision: number;
  /** Seconds of play in this run. */
  playtime: number;
  /** Current station name / archetype (shown in the slot list). */
  station: string;
  archetype: LevelId;
  stationsVisited: number;
  networkSeed: number;
  won: boolean;
  /** Why this write happened ('departure' | 'arrival' | 'new-game' | 'ending' (the Reactor credits' Main Menu) | 'import'). */
  reason: string;
  /** The game build that wrote it. */
  build: string;
}

/** The versioned save envelope (localStorage value AND the exported .json file). Data only — never code. */
export interface SaveFileV1 {
  format: 'terminal-state-save';
  v: 1;
  meta: SaveMeta;
  /** The serialized run (save/serialize.ts owns its exact shape: campaign + per-station memories + carry + participants + Retry entry). */
  run: unknown;
  /** Integrity checksum of `run` (FNV-1a of its canonical JSON; integrity, not security). */
  checksum: string;
}
