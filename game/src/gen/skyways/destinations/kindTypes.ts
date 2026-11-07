// Task studio-skyways-destinations-20261106-170011-01: the shape every Skyways DESTINATION prop kind declares (one spec per kind in its
// lane's kinds file: kindsLandmarks.ts / kindsShopsA.ts / kindsShopsB.ts), merged by registry.ts and spread into the shared tables
// (gen/props.ts PROP_DEFS, damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts PROP_PHYSICS_AUDIT, world/openablesSpec.ts
// OPENABLE_AUDIT). Pure data (no three.js). Root CLAUDE.md "Props — core design rules": every kind classified honestly.

import type {PropDef} from '../../props';
import type {DamageClass, PhysMat, StaticWhy} from '../../../damage/materials';
import type {SkywaysDestPropKey} from '../../../assets/skywaysDestProps.generated';
import type {PartMat} from '../../purposeShapes'; // task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-HOCKEY): drawn parts

/**
 * (task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-HOCKEY) One CODE-DRAWN box part of a model-less kind: prop frame
 * (origin bottom centre, front +Z, metres), size `s`, centre `p`, rotated about X (`rx`) then Y (`ry`), then translated; `m` = a shape
 * material (gen/propShapes.ts) or a purpose material (gen/purposeShapes.ts: the painted colours). Geometry only — no drawn texture.
 */
export interface DestDrawnPart { m: PartMat; s: readonly [number, number, number]; p: readonly [number, number, number]; rx?: number; ry?: number }

/** Rigid-body row (the live physics come from `def.physics`) or the static reason. */
export type DestPhys =
  | {dynamic: true; mass: number; mat: PhysMat; shape: 'box' | 'cylinder'; onHost?: boolean; how: string}
  | {dynamic: false; why: StaticWhy; how: string};

/** Openables audit row (cls 'openable' only with a real openable implementation; else an honest none / exception). */
export interface DestOpen { cls: 'exception' | 'none'; role: 'equipment' | 'decor' | 'surface' | 'storage'; how: string }

export interface DestKindSpec {
  def: PropDef;
  phys: DestPhys;
  damage: DamageClass;
  open: DestOpen;
  /** The Meshy model it renders with (assets/skywaysDestProps.generated.ts key); absent = drawn by code (art panels / parts). */
  model?: SkywaysDestPropKey;
  /**
   * (task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-HOCKEY) A model-less kind's code-drawn parts per placement variant
   * (world/skywaysDestinations.ts draws them merged per material, one batch per variant; tools/asset-pipeline/props/scale-check.mjs
   * renders variant 0). Absent: the model / art / stand-in path as before.
   */
  parts?: (variant: number) => readonly DestDrawnPart[];
}
