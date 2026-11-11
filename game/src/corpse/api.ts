// Task studio-corpse-chipper-fuel-20261110-235304-01: the CONTRACT between the corpse system (world/corpses.ts: dead bodies, carrying,
// station / train ownership) and the places that take a body (the train's chipper, world/chipper.ts). Types only.
//
// A body is in exactly one place. Handing it to a sink is a MOVE: when take() returns true the corpse system forgets it in the same call
// (no record, no object of it left there) and the sink owns its record (persisted at once in its own state, e.g. the chipper's job) and
// its model object (disposed through disposeBody when done).

import type * as THREE from 'three';
import type {BodyRecordJSON} from './bodyRecord';
import type {RagdollTarget} from '../physics/ragdoll';

/** The body in the player's hands. */
export interface HeldBody {
  /** Identity + look (+ size); the pose fields are zero — a carried body has no resting pose (the sink sets its own). */
  readonly record: BodyRecordJSON;
  /**
   * The body's real model: its actor's ROOT (skinned meshes, wardrobe, wounds; bones by name: 'Hips', 'Head', 'L_Foot' …), in the scene
   * under the corpse system's carry frame. offer(): in the carry pose; take(): at rest in the 'lying' pose (straight, culled round the
   * whole body), still under the carry frame — the sink re-parents it; after a true take() the corpse system never touches it again.
   */
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
  /**
   * The ragdoll target (its actor: bones, scale, rig) of a model from buildBody / a taken HeldBody, until disposeBody (null: not one of
   * this system's bodies). A sink may run its own ragdoll on it (the chipper's feed, world/chipperRagdoll.ts); the object stays the sink's.
   */
  ragdollTarget?(obj: THREE.Object3D): RagdollTarget | null;
}
