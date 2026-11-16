// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE PHYSICAL UPGRADE KIT'S [E] — a recovered train armour kit
// (craft/equipment.ts kind 'armor-kit': a stack of plating on the fuel dolly's hand truck, an ordinary dolly unit with its own uid) is
// fitted to the train THROUGH THE ONE UPGRADES SEAM (run/trainUpgrades.ts TrainUpgradesApi, world/trainArmor.ts) once it is wheeled into
// the parked car. Tapping [E] on it:
//  - not wholly inside the PARKED car of this world: "Wheel the train armour kit into the train to fit it" (kept);
//  - the seam refuses (already fitted / no parked train / moving): that reason (kept);
//  - install(id) true: the kit is USED UP (TrainEquipmentSystem.consume — only now, only once) and "Train armour fitted";
//    install(id) false: the seam's lastRefusal (kept).
// The kit IS the materials: no second charge, no effect beyond the seam's own (the same armour a bench craft fits). Holding [E] drags it
// like every dolly unit (the equipment system's own rule).

import type {EquipmentUnit, EquipmentUse} from '../../craft/equipmentApi';
import type {TrainUpgradesApi} from '../../run/trainUpgrades';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const KIT_TEXT = {
  fit: (up: string) => `<b>[E]</b> Fit ${up}`,
  wheelIn: (kit: string, up: string) => `Wheel ${kit} into the train to fit ${up}`,
  /** The look-at line outside the car. */
  outside: (kit: string) => `${cap(kit)} · wheel it into the train to fit it`,
  refused: (kit: string, why: string) => `${cap(kit)} · ${why}`,
  fitted: (up: string) => `${cap(up)} fitted`,
  noTrain: 'There is no parked train here to fit it to',
} as const;

/** What the kit's use needs of the equipment system. */
export interface KitEquipment {
  inParkedCar(uid: string): boolean;
  consume(uid: string): boolean;
}

export interface KitDeps {
  equipment(): KitEquipment | null;
  upgrades(): (TrainUpgradesApi & {lastRefusal?: string | null}) | null;
  toast(text: string, warn?: boolean): void;
  denied?(): void;
}

/** The [E] use of every upgrade-kit kind (registered on TrainEquipmentSystem.uses by world/surface/cargo.ts). */
export function kitUse(d: KitDeps): EquipmentUse {
  return {
    prompt(u: EquipmentUnit): string | null {
      const up = u.def.upgrade, eq = d.equipment();
      if (!up || !eq) return null;
      if (!eq.inParkedCar(u.uid)) return KIT_TEXT.outside(u.def.the);
      const api = d.upgrades(), why = api ? api.block(up.id) : KIT_TEXT.noTrain;
      return why ? KIT_TEXT.refused(u.def.the, why) : KIT_TEXT.fit(up.the);
    },
    tap(u: EquipmentUnit): boolean {
      const up = u.def.upgrade, eq = d.equipment();
      if (!up || !eq) return false;
      const no = (text: string): boolean => { d.toast(text, true); d.denied?.(); return true; };
      if (!eq.inParkedCar(u.uid)) return no(KIT_TEXT.wheelIn(u.def.the, up.the));
      const api = d.upgrades();
      if (!api) return no(KIT_TEXT.noTrain);
      const why = api.block(up.id);
      if (why) return no(why);
      if (!api.install(up.id)) return no(api.lastRefusal ?? KIT_TEXT.noTrain);
      // (fitted: the kit is used up now — exactly once; it never comes back from a record)
      eq.consume(u.uid);
      d.toast(KIT_TEXT.fitted(up.the));
      return true;
    },
  };
}
