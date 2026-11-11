// Task studio-corpse-chipper-fuel-20261110-235304-01: the CONTRACT between the corpse system (world/corpses.ts: dead bodies, carrying,
// station / train ownership) and the places that take a body (the train's chipper, world/chipper.ts). Types only.
//
// A body is in exactly one place. Handing it to a sink is a MOVE: when take() returns true the corpse system forgets it in the same call
// (no record, no object of it left there) and the sink owns its record (persisted at once in its own state, e.g. the chipper's job) and
// its model object (disposed through disposeBody when done).

import type * as THREE from 'three';
import type {BodyRecordJSON} from './bodyRecord';

/** The body in the player's hands. */
export interface HeldBody {
  /** Identity + look; the pose fields are its last resting pose (the sink re-poses it). */
  readonly record: BodyRecordJSON;
  /** The body's real model (its actor's root: skinned meshes, wardrobe, wounds), in the carry pose, in the scene. */
  readonly object: THREE.Object3D;
}

/** What a sink says about the held body right now (the player in reach of it, looking at it). */
export interface BodyOffer {
  /** Prompt text (e.g. 'E Feed the body into the chipper', or a refusal reason). */
  text: string;
  /** false = a refusal (shown; E does nothing; the body stays in the hands). */
  ok: boolean;
}

/** A place that takes held bodies. The corpse system asks its sinks, in order, before its own drop. */
export interface BodySink {
  offer(held: HeldBody): BodyOffer | null;
  /** Take the body (only after an ok offer this frame). true = it is the sink's now. */
  take(held: HeldBody): boolean;
}

/** What the corpse system offers its sinks (Game.corpses). */
export interface CorpseSystemApi {
  held(): HeldBody | null;
  addSink(s: BodySink): void;
  /**
   * The real model of a body from its record (any station: the look is rebuilt from seed / type / look / archetype), posed at rest, not
   * yet in the scene; null while its archetype's model is not loaded (the system preloads every body it or a sink's record names).
   */
  buildBody(rec: BodyRecordJSON): THREE.Object3D | null;
  /** Free a model from buildBody / a taken HeldBody. */
  disposeBody(obj: THREE.Object3D): void;
}
