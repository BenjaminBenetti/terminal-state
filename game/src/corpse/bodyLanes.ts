// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): where a HANDLED body is kept between worlds — pure records (no three.js /
// DOM), read by the corpse system (world/corpses.ts), save validation (save/validate.ts) and the model prefetch of a section.
//  - THE HANDS: run participant CORPSE_CARRY_PARTICIPANT `{v: 1, held}` — the body the player carries (null: hands free). Its pose fields
//    are ZERO (a carried body has no resting pose; a sink sets its own). Saved / loaded (restored into the hands), Retry restores the level
//    entry's, NewGame none. An older save has no record: hands free.
//  - A STATION: section-memory lane STATION_BODIES_LANE `{v: 1, here}` — the handled bodies lying there (world pose + storey), rebuilt as
//    posed bodies on every rebuild / reload / revisit. Absent: none.
//  - THE TRAIN: run/trainCargo.ts v3 `bodies` (train-local poses); THE CHIPPER: fuel/chipperFuel.ts job.body.
// ONE BODY, ONE PLACE: a body id is in exactly one of those (save/validate.ts refuses a save naming one twice). Bodies are never conjured
// from kill lists: only a body that was picked up at least once is a record anywhere (an untouched corpse is not saved, as before).

import {BODIES, bodiesProblem, bodyProblem, copyBody, type BodyRecordJSON} from './bodyRecord';

/** Run participant id of the carried body. */
export const CORPSE_CARRY_PARTICIPANT = 'corpse-carry';
/** Section-memory lane of the handled bodies lying in a station. */
export const STATION_BODIES_LANE = 'corpses.here';

export interface CorpseCarryJSON { v: 1; held: BodyRecordJSON | null }
export interface StationBodiesJSON { v: 1; here: BodyRecordJSON[] }

type Feedable = (arch: string) => boolean;

/** Why a carry record is malformed (null = fine). The held body: a train-local-shaped record (zero pose, no storey). */
export function carryProblem(v: unknown, feedable: Feedable): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the carried body record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'held') return `unexpected carried body field '${k}'`;
  if (o.v !== 1) return 'unsupported carried body version';
  if (o.held === null) return null;
  return bodyProblem(o.held, {world: false, feedable});
}

/** Why a station's body record is malformed (null = fine): at most BODIES.stationHere world-posed bodies, each once. */
export function stationBodiesProblem(v: unknown, feedable: Feedable): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the station body record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'here') return `unexpected station body field '${k}'`;
  if (o.v !== 1) return 'unsupported station body record version';
  return bodiesProblem(o.here, {world: true, max: BODIES.stationHere, feedable});
}

/** A station's bodies (absent / malformed: none — nothing invented). Copies. */
export function stationBodiesOf(d: unknown, feedable: Feedable): BodyRecordJSON[] {
  return d !== undefined && stationBodiesProblem(d, feedable) === null ? (d as StationBodiesJSON).here.map(copyBody) : [];
}

/** The carried body of a raw (validated or not) carry record (absent / malformed: none). */
export function carriedBodyOf(d: unknown, feedable: Feedable): BodyRecordJSON | null {
  return d !== undefined && carryProblem(d, feedable) === null && (d as CorpseCarryJSON).held ? copyBody((d as CorpseCarryJSON).held!) : null;
}

/** The zero pose a carried body's record keeps (identity + look unchanged). */
export function heldRecord(b: BodyRecordJSON): BodyRecordJSON {
  const r = copyBody(b);
  r.x = r.y = r.z = 0;
  r.q = [0, 0, 0, 1];
  delete r.level;
  // (task studio-refinement-batch-20261113-035659-01, lane DROPS: a body picked up from where it fell has no resting pose in the hands)
  r.pose = 'lying';
  delete r.bones;
  delete r.hips;
  delete r.falling;
  return r;
}
