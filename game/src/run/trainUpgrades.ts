// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): the player train's PERMANENT UPGRADES — the part of the train record
// (run/playerTrain.ts PlayerTrainRecord.upgrades) that says which one-time upgrades are fitted to the car. Today there is one: 'armor'
// (world/trainArmor.ts: the welded plating / blades / saw skirts and the end ploughs). User: "Train plating/blades: permanent ONE-TIME
// 10-scrap_metal upgrade, no durability."
//
// The record is a set of fitted ids, nothing else: no durability, no wear, no count. Fitting is one-way inside a run (install() never
// takes one off); NewGame resets it to none; Travel keeps it (the record travels with the train); Retry / Load / Continue / export-import
// restore exactly what the train record held (the participant's save at level entry / in the save file) — a craft undone by Retry
// un-fits it again together with the refunded scrap (the inventory is restored by the same snapshot): never a free upgrade, never a
// lost one.
//
// Save: `upgrades` in the player-train participant data — {v: 1, fitted: ['armor']}, written only while something is fitted (an old save
// and an unfitted train have no key: absent = none fitted, no version bump). A damaged value is rejected by the save validator
// (save/validate.ts participants) and, wherever it is loaded anyway, loads as NONE fitted (never a free upgrade). Pure (no three.js / DOM).

/** The one-time train upgrades (one today). */
export type TrainUpgradeId = 'armor';
/** Every upgrade id, in a fixed order (the save lists fitted ids in this order). */
export const TRAIN_UPGRADE_IDS: readonly TrainUpgradeId[] = Object.freeze(['armor'] as const);

export interface TrainUpgradesJSON {
  v: 1;
  /** The fitted upgrades (each at most once, known ids only). */
  fitted: TrainUpgradeId[];
}

const isUpgradeId = (v: unknown): v is TrainUpgradeId => typeof v === 'string' && (TRAIN_UPGRADE_IDS as readonly string[]).includes(v);

/** Why `d` is not a valid saved upgrades record (null: valid). Strict: exactly {v: 1, fitted: [unique known ids]}. */
export function trainUpgradesProblem(d: unknown): string | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'not an object';
  const o = d as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'fitted') return `unknown key '${k}'`;
  if (o.v !== 1) return 'unsupported upgrades version';
  if (!Array.isArray(o.fitted)) return 'fitted is not a list';
  if (o.fitted.length > TRAIN_UPGRADE_IDS.length) return 'too many fitted upgrades';
  const seen = new Set<string>();
  for (const id of o.fitted) {
    if (!isUpgradeId(id)) return `unknown upgrade '${String(id).slice(0, 32)}'`;
    if (seen.has(id)) return `upgrade '${id}' listed twice`;
    seen.add(id);
  }
  return null;
}

/** The fitted upgrades of the run's train (the same object for the whole session; load / reset write it in place). */
export class TrainUpgrades {
  private readonly fitted = new Set<TrainUpgradeId>();
  /** Bumped by every change (fit / load / reset): the runtime (world/trainArmor.ts) re-syncs the car on a change. */
  version = 0;

  has(id: TrainUpgradeId): boolean {
    return this.fitted.has(id);
  }

  /** Something is fitted. */
  get any(): boolean {
    return this.fitted.size > 0;
  }

  /** Fit `id` for good. False (nothing changed): an unknown id or already fitted. */
  fit(id: TrainUpgradeId): boolean {
    if (!isUpgradeId(id) || this.fitted.has(id)) return false;
    this.fitted.add(id);
    this.version++;
    return true;
  }

  /** The fitted ids in TRAIN_UPGRADE_IDS order. */
  list(): TrainUpgradeId[] {
    return TRAIN_UPGRADE_IDS.filter(id => this.fitted.has(id));
  }

  toJSON(): TrainUpgradesJSON {
    return {v: 1, fitted: this.list()};
  }

  /** Exact load (absent / malformed: NONE fitted — never a free upgrade). */
  load(d: unknown): void {
    this.fitted.clear();
    if (d !== undefined && trainUpgradesProblem(d) === null) for (const id of (d as TrainUpgradesJSON).fitted) this.fitted.add(id);
    this.version++;
  }

  /** NewGame: none fitted. */
  reset(): void {
    this.fitted.clear();
    this.version++;
  }
}

/**
 * The seam the crafting code calls (Game.trainUpgrades; world/trainArmor.ts implements it). The craft debits the materials FIRST and
 * then calls install(); a false install() means the craft refunds them.
 */
export interface TrainUpgradesApi {
  /** Permanently fitted to the run's train. */
  installed(id: TrainUpgradeId): boolean;
  /** Why it cannot be fitted right now (already fitted, the train moving, no train here, ...) or null. */
  block(id: TrainUpgradeId): string | null;
  /** Fit it now (the craft has ALREADY debited its materials); false: not fitted (the craft refunds). */
  install(id: TrainUpgradeId): boolean;
}
