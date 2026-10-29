// Iteration 16 (lane RUN): lane GEAR's grounded-bag store (gear/bagStore.ts BagStore shape) backed by RUN's per-section
// memory, so grounded bags follow the run exactly like the rest of a section's state: kept across travel, restored with
// the level's memories on Retry level, dropped with the old run on NewGame. Records are opaque JSON-safe data (GEAR's).

import type {LevelId, SectionKey} from '../levels/types';
import type {RunState} from './runState';

export const BAG_LANE = 'gear.bags';

/** 'office:floor-5' -> {level: 'office', section: 'floor-5'}. */
export function parseSectionId(id: string): SectionKey {
  const i = id.indexOf(':');
  return i < 0 ? {level: id as LevelId, section: 'main'} : {level: id.slice(0, i) as LevelId, section: id.slice(i + 1)};
}

export interface RunBagStore {
  load(sectionId: string): unknown;
  save(sectionId: string, rec: unknown): void;
  clear(): void;
  toJSON(): Record<string, unknown>;
  loadJSON(j: unknown): void;
}

export function runBagStore(run: () => RunState): RunBagStore {
  return {
    load: id => {
      const v = run().laneStore(BAG_LANE, parseSectionId(id));
      return v === undefined ? undefined : structuredClone(v);
    },
    save: (id, rec) => run().setLaneStore(BAG_LANE, rec === undefined || rec === null ? undefined : structuredClone(rec), parseSectionId(id)),
    clear: () => { const r = run(); for (const id of r.memoryIds()) r.setLaneStore(BAG_LANE, undefined, parseSectionId(id)); },
    toJSON: () => {
      const r = run(), out: Record<string, unknown> = {};
      for (const id of r.memoryIds()) { const v = r.laneStore(BAG_LANE, parseSectionId(id)); if (v !== undefined) out[id] = structuredClone(v); }
      return out;
    },
    loadJSON: j => {
      const r = run();
      for (const id of r.memoryIds()) r.setLaneStore(BAG_LANE, undefined, parseSectionId(id));
      if (j && typeof j === 'object') for (const [id, v] of Object.entries(j as Record<string, unknown>)) r.setLaneStore(BAG_LANE, structuredClone(v), parseSectionId(id));
    },
  };
}
