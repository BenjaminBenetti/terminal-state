// Iteration 16 (lane RUN): one RUN of the game — from NewGame until the next NewGame.
//
// Holds the per-logical-level seeds (fixed for the run: a section regenerates identically every time it is entered),
// the level-wide gear roll (lane GEAR, gen/gearLoot.ts: section -> gear items), the section being played, every
// section's memory (run/memory.ts) and the "Retry level" snapshot taken when the current level was entered.
// Pure (no three.js / DOM): tests drive it directly.

import {sectionId, type Arrival, type LevelId, type SectionKey} from '../levels/types';
import {cloneMemory, createMemory, type SectionMemory} from './memory';
import type {RunSnapshot} from './snapshot';

export type LevelSeeds = Record<LevelId, number>;
/** Gear items per section of one logical level (lane GEAR's rollLevelGear result). */
export type LevelGear = Record<string, {itemId: string}[]>;

export interface RunInit {
  seeds: LevelSeeds;
  /** Section the run starts in. */
  start: SectionKey;
  gear?: Partial<Record<LevelId, LevelGear>>;
}

let runCounter = 0;

export class RunState {
  /** Increments per run (QA: a NewGame made a new run). */
  readonly id = ++runCounter;
  readonly seeds: Readonly<LevelSeeds>;
  readonly gear: Partial<Record<LevelId, LevelGear>>;
  /** The section being played (during a travel: the one being LEFT until the new one is built). */
  current: SectionKey;
  /** How the player arrived in `current`. */
  arrival: Arrival = {kind: 'start'};
  /** Snapshot taken when the current logical level was entered (Retry level). */
  entry: RunSnapshot | null = null;
  /** Logical levels entered in this run, in order (QA). */
  readonly entered: LevelId[] = [];
  private readonly memories = new Map<string, SectionMemory>();

  constructor(init: RunInit) {
    this.seeds = Object.freeze({...init.seeds});
    this.gear = init.gear ?? {};
    this.current = {...init.start};
  }

  /** `${level}:${section}` of `current` (lane GEAR keys its grounded bags by it). */
  get sectionId(): string {
    return sectionId(this.current);
  }

  /** The memory of a section (created empty on first use). Default: the current section. */
  memory(key: SectionKey = this.current): SectionMemory {
    const id = sectionId(key);
    let m = this.memories.get(id);
    if (!m) this.memories.set(id, (m = createMemory(key)));
    return m;
  }

  /** The memory if the section was ever touched (no creation). */
  peekMemory(key: SectionKey): SectionMemory | undefined {
    return this.memories.get(sectionId(key));
  }

  /** Every remembered section id (QA). */
  memoryIds(): string[] {
    return [...this.memories.keys()].sort();
  }

  /** Lane store of a section (lane GEAR: grounded bags). JSON-safe plain data. */
  laneStore<T = unknown>(lane: string, key: SectionKey = this.current): T | undefined {
    return this.peekMemory(key)?.lanes[lane] as T | undefined;
  }

  setLaneStore(lane: string, data: unknown, key: SectionKey = this.current): void {
    const m = this.memory(key);
    if (data === undefined) delete m.lanes[lane];
    else m.lanes[lane] = data;
  }

  /** Deep copies of one level's section memories (snapshot). */
  levelMemories(level: LevelId): Record<string, SectionMemory> {
    const out: Record<string, SectionMemory> = {};
    for (const [id, m] of this.memories) if (id.startsWith(`${level}:`)) out[id] = cloneMemory(m);
    return out;
  }

  /** Replace one level's section memories by deep copies of `mems` (Retry level). Other levels are untouched. */
  restoreLevelMemories(level: LevelId, mems: Record<string, SectionMemory>): void {
    for (const id of [...this.memories.keys()]) if (id.startsWith(`${level}:`)) this.memories.delete(id);
    for (const [id, m] of Object.entries(mems)) if (id.startsWith(`${level}:`)) this.memories.set(id, cloneMemory(m));
  }

  /** Gear assigned to a section by the level-wide roll (empty when none). */
  gearFor(key: SectionKey): {itemId: string}[] {
    return this.gear[key.level]?.[key.section] ?? [];
  }

  /** Every section of `level` remembered as cleared (all of `sections`). */
  levelCleared(level: LevelId, sections: readonly string[]): boolean {
    return sections.length > 0 && sections.every(s => this.peekMemory({level, section: s})?.cleared === true);
  }
}

/** A fresh run: seeds as given, the level-wide gear roll per logical level (lane GEAR). */
export function createRun(o: {
  seeds: LevelSeeds;
  start: SectionKey;
  levels: Record<LevelId, {sections(levelSeed: number): string[]}>;
  rollGear?: (levelSeed: number, level: LevelId, sections: string[]) => LevelGear;
}): RunState {
  const gear: Partial<Record<LevelId, LevelGear>> = {};
  if (o.rollGear) {
    for (const level of Object.keys(o.levels) as LevelId[]) {
      try { gear[level] = o.rollGear(o.seeds[level], level, o.levels[level].sections(o.seeds[level])); } catch (err) { console.warn(`Iteration 16 (RUN): gear roll for ${level} failed`, err); }
    }
  }
  return new RunState({seeds: o.seeds, start: o.start, gear});
}
